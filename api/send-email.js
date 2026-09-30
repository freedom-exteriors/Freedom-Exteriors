import { requireStaff } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!(await requireStaff(req, res))) return;

  const { to, homeownerName, jobType, portalLink } = req.body;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.RESEND_API_KEY || process.env.REACT_APP_RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: "Freedom Exteriors <nick@freedom-exteriors.com>",
      to: [to],
      subject: "Your Freedom Exteriors Job Portal is Ready",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#080d14;color:#e2eaf4;padding:32px;border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;">
            <h1 style="font-size:28px;letter-spacing:4px;margin:0;">
              <span style="color:#1a9e99;">FREEDOM </span>
              <span style="color:#e8a820;">EXTERIORS</span>
            </h1>
            <p style="color:#1a9e99;font-size:11px;letter-spacing:3px;margin:4px 0 0;">VETERAN OWNED & OPERATED</p>
          </div>
          <h2 style="color:#e8a820;">Hi ${homeownerName}!</h2>
          <p style="color:#e2eaf4;font-size:15px;line-height:1.6;">
            Your <strong>${jobType}</strong> job with Freedom Exteriors has been created. 
            You can track your job status, sign documents, upload photos, and message your rep anytime through your personal portal.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${portalLink}" style="background:#e8a820;color:#000;padding:14px 32px;border-radius:8px;font-weight:800;font-size:16px;text-decoration:none;display:inline-block;">
              View Your Job Portal →
            </a>
          </div>
          <p style="color:#6b8099;font-size:13px;">Questions? Call us at (651) 283-1689 or reply to this email.</p>
          <hr style="border-color:#1e3048;margin:24px 0;"/>
          <p style="color:#6b8099;font-size:11px;text-align:center;">Freedom Exteriors LLC · 1145 Summit Ave · Mahtomedi, MN 55115</p>
        </div>
      `,
    }),
  });

  const data = await response.json();
  if (response.ok) {
    res.status(200).json({ success: true });
  } else {
    res.status(400).json({ error: data });
  }
}