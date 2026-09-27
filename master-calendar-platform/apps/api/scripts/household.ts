// Set up a real household without anyone sharing a password: creates the workspace, one
// Participant per person, and an email-locked invite for each. Each person opens their
// link, creates an account with that email, and lands in the home as themselves.
//
//   DATABASE_URL=… PUBLIC_WEB_URL=https://… npm run household -w @mcp/api -- \
//     --name "Jawor Family" --tz America/Chicago \
//     --owner nicholasjawor@gmail.com:Nicholas:driver \
//     --member someone@example.com:Sam:driver --member kid@example.com:Kid
//
// Person format: email:Name[:driver]. Links are printed once and expire in 14 days; the
// owner can issue new ones from Settings → People.
import path from "node:path";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { createPrismaClient, createWorkspaceFromTemplate } from "@mcp/db";
import { generateSessionToken, hashToken } from "../src/auth/session.js";
import { nextParticipantColor } from "../src/lib/colors.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const { values } = parseArgs({
  options: {
    name: { type: "string" },
    tz: { type: "string", default: "America/Chicago" },
    owner: { type: "string", multiple: true, default: [] },
    member: { type: "string", multiple: true, default: [] },
    viewer: { type: "string", multiple: true, default: [] },
  },
});

interface Person { email: string; name: string; canDrive: boolean; role: "owner" | "member" | "viewer" }
const people: Person[] = (["owner", "member", "viewer"] as const).flatMap((role) =>
  values[role].map((spec) => {
    const [email, name, flag] = spec.split(":");
    if (!email?.includes("@") || !name) throw new Error(`Bad person "${spec}" (want email:Name[:driver])`);
    return { email: email.trim().toLowerCase(), name: name.trim(), canDrive: flag === "driver", role };
  }),
);
if (!values.name || !people.some((p) => p.role === "owner")) {
  console.error('usage: --name "Family name" --owner email:Name[:driver] [--member …] [--viewer …] [--tz Area/City]');
  process.exit(1);
}
const webUrl = (process.env.PUBLIC_WEB_URL || "").replace(/\/$/, "");
if (!webUrl) throw new Error("PUBLIC_WEB_URL is not set (the invite links point there)");
new Intl.DateTimeFormat("en-US", { timeZone: values.tz }); // throws on an unknown zone

const prisma = createPrismaClient();
try {
  const taken = await prisma.user.findMany({ where: { email: { in: people.map((p) => p.email) } }, select: { email: true } });
  if (taken.length) throw new Error(`Already have accounts: ${taken.map((u) => u.email).join(", ")} — invite them from Settings instead`);

  const ws = await createWorkspaceFromTemplate(prisma, { name: values.name, vertical: "family" });
  await prisma.workspace.update({ where: { id: ws.id }, data: { timeZone: values.tz } });
  const colors: string[] = [];
  const links: { person: Person; url: string }[] = [];
  for (const person of people) {
    const color = nextParticipantColor(colors);
    colors.push(color);
    const participant = await prisma.participant.create({
      data: { workspaceId: ws.id, name: person.name, color, canDrive: person.canDrive },
    });
    const token = generateSessionToken();
    await prisma.workspaceInvite.create({
      data: {
        workspaceId: ws.id,
        tokenHash: hashToken(token),
        email: person.email,
        role: person.role,
        participantId: participant.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    links.push({ person, url: `${webUrl}/invite/${token}` });
  }
  console.log(`\nCreated "${ws.name}" (${values.tz}). Send each person their own link:\n`);
  for (const { person, url } of links) console.log(`  ${person.name.padEnd(10)} ${person.role.padEnd(7)} ${person.email}\n    ${url}\n`);
} finally {
  await prisma.$disconnect();
}
