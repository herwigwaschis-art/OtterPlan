-- A01/A03: roles are provisioned by an authorized school administrator only.
-- Preserve existing teachers, data and owner access by materializing owner links.
BEGIN;
INSERT INTO public.class_teacher_links(class_id,user_id)
SELECT c.id,c.teacher_id FROM public.classes c
JOIN public.school_members m ON m.school_id=c.school_id AND m.user_id=c.teacher_id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.profiles(id,role,display_name,must_change_password)
  VALUES(new.id,'student',coalesce(new.raw_user_meta_data->>'display_name',''),false)
  ON CONFLICT(id) DO NOTHING;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.is_teacher_role()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.id=auth.uid() AND p.role='teacher' AND NOT coalesce(u.is_anonymous,false)
 AND (EXISTS(SELECT 1 FROM public.school_members m WHERE m.user_id=p.id)
 OR EXISTS(SELECT 1 FROM public.classes c WHERE c.teacher_id=p.id AND c.school_id IS NULL)));
$$;
CREATE OR REPLACE FUNCTION public.is_school_member(target_school uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_teacher_role() AND EXISTS(SELECT 1 FROM public.school_members m
 WHERE m.school_id=target_school AND m.user_id=auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.is_school_admin(target_school uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_teacher_role() AND EXISTS(SELECT 1 FROM public.school_members m
 WHERE m.school_id=target_school AND m.user_id=auth.uid() AND m.role='admin');
$$;
CREATE OR REPLACE FUNCTION public.is_teacher_of_class(target_class uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_teacher_role() AND EXISTS(SELECT 1 FROM public.classes c
 WHERE c.id=target_class AND (
   (c.school_id IS NULL AND c.teacher_id=auth.uid()) OR
   (public.is_school_member(c.school_id) AND EXISTS(SELECT 1 FROM public.class_teacher_links l
     WHERE l.class_id=c.id AND l.user_id=auth.uid()))));
$$;
CREATE OR REPLACE FUNCTION public.is_class_admin(target_class uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_teacher_role() AND EXISTS(SELECT 1 FROM public.classes c WHERE c.id=target_class
 AND ((c.teacher_id=auth.uid() AND public.is_teacher_of_class(c.id)) OR public.is_school_admin(c.school_id)));
$$;
CREATE OR REPLACE FUNCTION public.has_grade_access(p_school_id uuid,p_grade_level smallint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_school_member(p_school_id) AND EXISTS(SELECT 1 FROM public.grade_teacher_links g
 WHERE g.school_id=p_school_id AND g.grade_level=p_grade_level AND g.user_id=auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.remove_school_member(p_school_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_school_admin(p_school_id) THEN RAISE EXCEPTION 'Keine Berechtigung'; END IF;
 IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'Eigenes Admin-Konto kann hier nicht entfernt werden'; END IF;
 DELETE FROM public.class_teacher_links l USING public.classes c
 WHERE l.class_id=c.id AND c.school_id=p_school_id AND l.user_id=p_user_id;
 DELETE FROM public.grade_teacher_links WHERE school_id=p_school_id AND user_id=p_user_id;
 -- Ownership is historical metadata; move it to the acting admin to avoid stale ownership.
 UPDATE public.classes SET teacher_id=auth.uid() WHERE school_id=p_school_id AND teacher_id=p_user_id;
 DELETE FROM public.school_members WHERE school_id=p_school_id AND user_id=p_user_id;
END $$;

-- Prevent direct writes from bypassing the school-aware RPCs or restoring ownership.
REVOKE INSERT,UPDATE,DELETE ON public.classes FROM anon,authenticated;
GRANT UPDATE(archived_at) ON public.classes TO authenticated;
ALTER POLICY class_update_teacher ON public.classes USING(public.is_class_admin(id)) WITH CHECK(public.is_class_admin(id));
-- App uses create_class_*/update_class_settings/archive_class_year RPCs.
ALTER POLICY class_teacher_links_read ON public.class_teacher_links
USING ((user_id=auth.uid() AND public.is_teacher_of_class(class_id)) OR public.is_class_admin(class_id));

CREATE OR REPLACE FUNCTION public.link_new_class_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new.school_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.school_members m WHERE m.school_id=new.school_id AND m.user_id=new.teacher_id)
 THEN INSERT INTO public.class_teacher_links(class_id,user_id) VALUES(new.id,new.teacher_id) ON CONFLICT DO NOTHING; END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.link_new_class_owner() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER class_owner_link AFTER INSERT OR UPDATE OF school_id,teacher_id ON public.classes
FOR EACH ROW EXECUTE FUNCTION public.link_new_class_owner();

-- A02: this guard is called before any privileged invitation or user lookup.
CREATE OR REPLACE FUNCTION public.authorize_teacher_provisioning(p_school_id uuid,p_class_ids uuid[],p_grade_levels smallint[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_school_admin(p_school_id) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM unnest(coalesce(p_class_ids,'{}'::uuid[])) x
 WHERE NOT EXISTS(SELECT 1 FROM public.classes c WHERE c.id=x AND c.school_id=p_school_id AND c.archived_at IS NULL))
 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM unnest(coalesce(p_grade_levels,'{}'::smallint[])) x WHERE x IS NULL OR x NOT BETWEEN 1 AND 4)
 THEN RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.authorize_teacher_provisioning(uuid,uuid[],smallint[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.authorize_teacher_provisioning(uuid,uuid[],smallint[]) TO authenticated;

-- Guard every provisioning path against anonymous target accounts. This trigger
-- also protects older, still available admin RPCs, not just the current UI.
CREATE OR REPLACE FUNCTION public.guard_school_teacher_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=new.user_id AND NOT coalesce(u.is_anonymous,false))
 THEN RAISE EXCEPTION 'Kindergeräte können keine Lehrkraftrechte erhalten'; END IF;
 RETURN new;
END $$;
REVOKE ALL ON FUNCTION public.guard_school_teacher_membership() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER school_member_permanent_identity BEFORE INSERT OR UPDATE ON public.school_members
FOR EACH ROW EXECUTE FUNCTION public.guard_school_teacher_membership();

-- B01: retain the existing hash unchanged but expose only non-secret columns.
-- No hash reset, no account password changes, no data destruction.
REVOKE SELECT ON public.school_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT(school_id,default_school_year,default_retention_days,teachers_can_create_classes,updated_at,pilot_mode,ai_analysis_enabled)
ON public.school_settings TO authenticated;

-- A05/B02: changing a QR code also revokes existing device bindings.
CREATE OR REPLACE FUNCTION public.reset_child_qr_code(p_student_id uuid)
RETURNS TABLE(qr_token text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_teacher_of_student(p_student_id) THEN RAISE EXCEPTION 'Keine Berechtigung für dieses Kind'; END IF;
 PERFORM 1 FROM public.students WHERE id=p_student_id FOR UPDATE;
 INSERT INTO public.stable_child_qr_codes(student_id,code,active,updated_at)
 VALUES(p_student_id,gen_random_uuid(),true,now())
 ON CONFLICT(student_id) DO UPDATE SET code=gen_random_uuid(),active=true,updated_at=now();
 UPDATE public.child_access_codes SET active=false WHERE student_id=p_student_id AND active;
 DELETE FROM public.student_device_links WHERE student_id=p_student_id;
 UPDATE public.students SET child_user_id=NULL WHERE id=p_student_id;
 RETURN QUERY SELECT q.code::text FROM public.stable_child_qr_codes q WHERE q.student_id=p_student_id;
END $$;
CREATE OR REPLACE FUNCTION public.revoke_child_devices(p_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_teacher_of_student(p_student_id) THEN RAISE EXCEPTION 'Keine Berechtigung für dieses Kind'; END IF;
 PERFORM 1 FROM public.students WHERE id=p_student_id FOR UPDATE;
 DELETE FROM public.student_device_links WHERE student_id=p_student_id;
 UPDATE public.students SET child_user_id=NULL WHERE id=p_student_id;
 UPDATE public.stable_child_qr_codes SET active=false,updated_at=now() WHERE student_id=p_student_id;
 UPDATE public.child_access_codes SET active=false WHERE student_id=p_student_id;
END $$;
CREATE OR REPLACE FUNCTION public.is_child_student(target_student uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.students s JOIN public.classes c ON c.id=s.class_id
 WHERE s.id=target_student AND s.archived_at IS NULL AND c.archived_at IS NULL
 AND (s.child_user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.student_device_links l
 WHERE l.student_id=s.id AND l.user_id=auth.uid())));
$$;
CREATE OR REPLACE FUNCTION public.redeem_child_qr(p_qr_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_student_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND is_anonymous)
 THEN RAISE EXCEPTION 'Dieser Zugang ist nur für Kindergeräte vorgesehen'; END IF;
 -- Resolve first, then lock the pupil and recheck token validity. Rotation and
 -- redemption serialize on the same row, so an in-flight old token cannot rebind.
 SELECT q.student_id INTO v_student_id FROM public.stable_child_qr_codes q
 WHERE q.code::text=p_qr_token AND q.active;
 IF v_student_id IS NULL THEN
 SELECT c.student_id INTO v_student_id FROM public.child_access_codes c WHERE c.active
 AND c.token_hash=encode(extensions.digest(p_qr_token,'sha256'),'hex')
 AND (c.expires_at IS NULL OR c.expires_at>now()) LIMIT 1;
 END IF;
 IF v_student_id IS NULL THEN RAISE EXCEPTION 'QR-Code ist ungültig'; END IF;
 PERFORM 1 FROM public.students s JOIN public.classes c ON c.id=s.class_id
 WHERE s.id=v_student_id AND s.archived_at IS NULL AND c.archived_at IS NULL FOR UPDATE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'QR-Code ist ungültig'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.stable_child_qr_codes q WHERE q.student_id=v_student_id AND q.active AND q.code::text=p_qr_token)
 AND NOT EXISTS(SELECT 1 FROM public.child_access_codes c WHERE c.student_id=v_student_id AND c.active
 AND c.token_hash=encode(extensions.digest(p_qr_token,'sha256'),'hex') AND (c.expires_at IS NULL OR c.expires_at>now()))
 THEN RAISE EXCEPTION 'QR-Code ist ungültig'; END IF;
 INSERT INTO public.student_device_links(user_id,student_id,linked_at) VALUES(auth.uid(),v_student_id,now())
 ON CONFLICT(user_id) DO UPDATE SET student_id=excluded.student_id,linked_at=now();
 UPDATE public.profiles SET role='student',display_name='' WHERE id=auth.uid();
 RETURN v_student_id;
END $$;

-- Keep teacher-owned note templates on the server instead of shared-device storage.
CREATE OR REPLACE FUNCTION public.get_or_create_child_qr_code(p_student_id uuid)
RETURNS TABLE(qr_token text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_teacher_of_student(p_student_id) THEN RAISE EXCEPTION 'Keine Berechtigung für dieses Kind'; END IF;
 PERFORM 1 FROM public.students WHERE id=p_student_id FOR UPDATE;
 INSERT INTO public.stable_child_qr_codes(student_id) VALUES(p_student_id)
 ON CONFLICT(student_id) DO UPDATE SET
 code=CASE WHEN stable_child_qr_codes.active THEN stable_child_qr_codes.code ELSE gen_random_uuid() END,
 active=true,updated_at=now();
 RETURN QUERY SELECT q.code::text FROM public.stable_child_qr_codes q WHERE q.student_id=p_student_id;
END $$;
CREATE OR REPLACE FUNCTION public.redeem_child_access_qr(p_qr_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN public.redeem_child_qr(p_qr_token); END $$;
CREATE OR REPLACE FUNCTION public.redeem_child_access(p_qr_token text,p_pin text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.child_access_codes c WHERE c.active
 AND c.token_hash=encode(extensions.digest(p_qr_token,'sha256'),'hex')
 AND c.pin_hash=extensions.crypt(p_pin,c.pin_hash) AND (c.expires_at IS NULL OR c.expires_at>now()))
 THEN RAISE EXCEPTION 'QR-Code oder PIN ist ungültig'; END IF;
 RETURN public.redeem_child_qr(p_qr_token);
END $$;

CREATE TABLE public.teacher_note_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 UNIQUE(teacher_id,body)
);
ALTER TABLE public.teacher_note_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.teacher_note_templates FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.teacher_note_templates TO authenticated;
CREATE POLICY own_teacher_note_templates ON public.teacher_note_templates FOR ALL TO authenticated
USING(teacher_id=auth.uid() AND public.is_teacher_role())
WITH CHECK(teacher_id=auth.uid() AND public.is_teacher_role());
COMMIT;
