import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const APP_URL = "https://herwigwaschis-art.github.io/OtterPlan/?invite=1";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 100) break;
  }
  return null;
}

function cleanGrades(value: unknown) {
  if (!Array.isArray(value)) return [] as number[];
  return [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 4))];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Nur POST erlaubt" });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) return json(500, { error: "Serverkonfiguration fehlt" });

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(401, { error: "Nicht angemeldet" });

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json(401, { error: "Sitzung ungültig" });
    if (authData.user.is_anonymous) return json(403, { ok: false, error: "Keine Berechtigung" });

    const body = await req.json();
    const action = String(body.action || "create");
    const schoolId = String(body.school_id || "");
    if (!schoolId) return json(200, { ok: false, error: "Schule fehlt" });
    // Authorization precedes every privileged lookup, invitation and reset mail.
    const { data: schoolAdmin, error: schoolError } = await userClient.rpc("is_school_admin", {
      target_school: schoolId,
    });
    if (schoolError || schoolAdmin !== true) return json(403, { ok: false, error: "Keine Berechtigung" });

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const displayName = String(body.display_name || "").trim();
      const role = body.role === "admin" ? "admin" : "teacher";
      const classIds = Array.isArray(body.class_ids) ? body.class_ids.map(String) : [];
      const gradeLevels = cleanGrades(body.grade_levels);

      if (!email || !email.includes("@")) return json(200, { ok: false, error: "Gültige E-Mail fehlt" });
      if (!displayName) return json(200, { ok: false, error: "Name fehlt" });
      const { data: permitted, error: permissionError } = await userClient.rpc("authorize_teacher_provisioning", {
        p_school_id: schoolId, p_class_ids: classIds, p_grade_levels: gradeLevels,
      });
      if (permissionError || permitted !== true) return json(403, { ok: false, error: "Zuordnung nicht erlaubt" });

      let user = await findUserByEmail(admin, email);
      let invited = false;

      if (!user) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: APP_URL,
          data: {
            display_name: displayName,
          },
        });

        if (error || !data.user) {
          return json(200, {
            ok: false,
            error: error?.message || "Einladung konnte nicht gesendet werden",
          });
        }

        user = data.user;
        invited = true;
      }

      const { error: configureError } = await userClient.rpc("configure_teacher_account", {
        p_user_id: user.id,
        p_school_id: schoolId,
        p_display_name: displayName,
        p_role: role,
        p_class_ids: classIds,
        p_grade_levels: gradeLevels,
        p_must_change_password: invited,
      });

      if (configureError) {
        return json(200, {
          ok: false,
          error: configureError.message || "Berechtigungen konnten nicht gespeichert werden",
        });
      }

      return json(200, {
        ok: true,
        invited,
        existing: !invited,
        user_id: user.id,
      });
    }

    if (action === "reset_password") {
      const targetUserId = String(body.user_id || "");
      if (!targetUserId) return json(200, { ok: false, error: "Lehrkraft fehlt" });

      const { data: allowed, error: allowedError } = await userClient.rpc("school_admin_can_manage_user", {
        p_school_id: schoolId,
        p_user_id: targetUserId,
      });

      if (allowedError || allowed !== true) {
        return json(200, { ok: false, error: "Keine Berechtigung für diese Lehrkraft" });
      }

      const { data: targetUser, error: targetUserError } = await admin.auth.admin.getUserById(targetUserId);
      const email = targetUser?.user?.email || "";
      if (targetUserError || !email) return json(200, { ok: false, error: "E-Mail-Adresse nicht gefunden" });

      const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo: APP_URL,
      });

      if (resetError) {
        return json(200, {
          ok: false,
          error: resetError.message || "Passwort-Mail konnte nicht gesendet werden",
        });
      }

      await userClient.rpc("mark_teacher_password_reset", {
        p_school_id: schoolId,
        p_user_id: targetUserId,
      });

      return json(200, { ok: true, email_sent: true });
    }

    return json(200, { ok: false, error: "Unbekannte Aktion" });
  } catch (error) {
    return json(200, {
      ok: false,
      error: error instanceof Error ? error.message : "Unbekannter Fehler",
    });
  }
});
