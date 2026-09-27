// Local dev/test seed: one workspace per vertical, each with several logins at different
// roles, participants, contacts, and sample events (assigned, unassigned, tagged).
// Re-runnable: it removes its own previously-seeded users/workspaces first.
//
//   npm run db:seed        (from the monorepo root)
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { hash } from "@node-rs/argon2";
import type { WorkspaceVertical } from "@mcp/shared-types";
import { createPrismaClient, createWorkspaceFromTemplate, type Prisma } from "../src/index.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });

const prisma = createPrismaClient();

interface SeedEvent {
  title: string;
  tagKey: string | null;
  participant: string | null; // participant name, or null = unassigned
  dayOffset: number; // days from today
  startHourUtc: number;
  durationMinutes: number;
  location?: string;
}

interface SeedWorkspace {
  name: string;
  vertical: WorkspaceVertical;
  participants: { name: string; color: string }[];
  users: { email: string; role: "owner" | "member" | "viewer"; participant: string | null }[];
  contacts: { name: string; role: string; organization?: string; email?: string; phone?: string }[];
  sourceName: string;
  defaultParticipant: string | null;
  events: SeedEvent[];
}

const workspaces: SeedWorkspace[] = [
  {
    name: "Rivera Family",
    vertical: "family",
    participants: [
      { name: "Alex", color: "#2563EB" },
      { name: "Sam", color: "#16A34A" },
      { name: "Maya", color: "#DB2777" },
      { name: "Leo", color: "#EA580C" },
    ],
    users: [
      { email: "alex@family.test", role: "owner", participant: "Alex" },
      { email: "sam@family.test", role: "member", participant: "Sam" },
      { email: "maya@family.test", role: "viewer", participant: "Maya" },
    ],
    contacts: [
      { name: "Coach Dana Brooks", role: "coach", organization: "Eastside FC U12", email: "dana@eastside-fc.test" },
      { name: "Ms. Patel", role: "teacher", organization: "Lincoln Elementary" },
      { name: "Dr. Chen", role: "doctor", organization: "Maple Pediatrics", phone: "555-0142" },
    ],
    sourceName: "Seed sample events",
    defaultParticipant: "Maya",
    events: [
      { title: "U12 Soccer Practice", tagKey: "practice", participant: "Maya", dayOffset: 1, startHourUtc: 22, durationMinutes: 90, location: "Eastside Park Field 3" },
      { title: "U12 Soccer vs. Westview", tagKey: "game", participant: "Maya", dayOffset: 3, startHourUtc: 15, durationMinutes: 90, location: "Westview HS" },
      { title: "Swim Practice", tagKey: "practice", participant: null, dayOffset: 2, startHourUtc: 23, durationMinutes: 60, location: "YMCA" },
      { title: "Leo — Well-child checkup", tagKey: "medical", participant: "Leo", dayOffset: 4, startHourUtc: 14, durationMinutes: 45, location: "Maple Pediatrics" },
      { title: "Early dismissal", tagKey: "school", participant: null, dayOffset: 5, startHourUtc: 18, durationMinutes: 30 },
      { title: "Neighborhood block party", tagKey: null, participant: null, dayOffset: 6, startHourUtc: 21, durationMinutes: 180 },
    ],
  },
  {
    name: "Jordan — Fall Semester",
    vertical: "student",
    participants: [{ name: "Jordan", color: "#7C3AED" }],
    users: [
      { email: "jordan@student.test", role: "owner", participant: "Jordan" },
      { email: "pat@student.test", role: "viewer", participant: null }, // a parent with read-only access
    ],
    contacts: [
      { name: "Prof. Alvarez", role: "professor", organization: "CHEM 101", email: "alvarez@uni.test" },
      { name: "Riley Kim", role: "tutor", organization: "Writing Center" },
    ],
    sourceName: "Seed sample events",
    defaultParticipant: "Jordan",
    events: [
      { title: "CHEM 101 Lecture", tagKey: "class", participant: "Jordan", dayOffset: 1, startHourUtc: 14, durationMinutes: 75, location: "Science Hall 120" },
      { title: "CHEM 101 Midterm", tagKey: "exam", participant: "Jordan", dayOffset: 5, startHourUtc: 14, durationMinutes: 90, location: "Science Hall 120" },
      { title: "English essay #2 due", tagKey: "assignment", participant: "Jordan", dayOffset: 2, startHourUtc: 23, durationMinutes: 0 },
      { title: "Calc study group", tagKey: "study_group", participant: null, dayOffset: 3, startHourUtc: 19, durationMinutes: 120, location: "Library 3rd floor" },
    ],
  },
  {
    name: "Northside Bakery",
    vertical: "business",
    participants: [
      { name: "Morgan", color: "#0891B2" },
      { name: "Casey", color: "#CA8A04" },
      { name: "Taylor", color: "#9333EA" },
    ],
    users: [
      { email: "morgan@business.test", role: "owner", participant: "Morgan" },
      { email: "casey@business.test", role: "member", participant: "Casey" },
    ],
    contacts: [
      { name: "Hilltop Catering", role: "client", email: "orders@hilltop.test" },
      { name: "Grain & Mill Supply", role: "vendor", phone: "555-0199" },
    ],
    sourceName: "Seed sample events",
    defaultParticipant: null,
    events: [
      { title: "Opening shift", tagKey: "staff_shift", participant: "Casey", dayOffset: 1, startHourUtc: 11, durationMinutes: 360 },
      { title: "Saturday opening shift", tagKey: "staff_shift", participant: null, dayOffset: 4, startHourUtc: 11, durationMinutes: 360 },
      { title: "Hilltop Catering — wedding order tasting", tagKey: "client_meeting", participant: "Morgan", dayOffset: 2, startHourUtc: 16, durationMinutes: 60 },
      { title: "Invoice #1042 due (Hilltop)", tagKey: "invoice_due", participant: null, dayOffset: 6, startHourUtc: 17, durationMinutes: 0 },
    ],
  },
];

function atDayOffset(dayOffset: number, hourUtc: number): Date {
  const d = new Date();
  d.setUTCHours(hourUtc, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d;
}

async function main() {
  const password = process.env.SEED_USER_PASSWORD ?? "password123";
  const passwordHash = await hash(password);

  const seedEmails = workspaces.flatMap((w) => w.users.map((u) => u.email));
  // Cascades remove memberships/sessions and all workspace-owned rows.
  await prisma.workspace.deleteMany({ where: { name: { in: workspaces.map((w) => w.name) } } });
  await prisma.user.deleteMany({ where: { email: { in: seedEmails } } });

  for (const spec of workspaces) {
    const workspace = await createWorkspaceFromTemplate(prisma, { name: spec.name, vertical: spec.vertical });

    const participantIdByName = new Map<string, string>();
    for (const p of spec.participants) {
      const row = await prisma.participant.create({ data: { workspaceId: workspace.id, ...p } });
      participantIdByName.set(p.name, row.id);
    }
    const pid = (name: string | null) => (name ? participantIdByName.get(name)! : null);

    for (const u of spec.users) {
      await prisma.user.create({
        data: {
          email: u.email,
          passwordHash,
          memberships: {
            create: { workspaceId: workspace.id, role: u.role, participantId: pid(u.participant) },
          },
        },
      });
    }

    await prisma.contact.createMany({ data: spec.contacts.map((c) => ({ workspaceId: workspace.id, ...c })) });

    const tags = await prisma.eventTagDefinition.findMany({ where: { workspaceId: workspace.id } });
    const tagIdByKey = new Map(tags.map((t) => [t.key, t.id]));

    // Synthetic source with no feedUrl, so the ICS sync job (step 3) will skip it.
    const source = await prisma.calendarSource.create({
      data: {
        workspaceId: workspace.id,
        name: spec.sourceName,
        type: "ics_feed",
        defaultParticipantId: pid(spec.defaultParticipant),
      },
    });

    await prisma.event.createMany({
      data: spec.events.map((e, i) => {
        const startTime = atDayOffset(e.dayOffset, e.startHourUtc);
        return {
          calendarSourceId: source.id,
          externalUid: `seed-${spec.vertical}-${i}`,
          participantId: pid(e.participant),
          eventTagId: e.tagKey ? tagIdByKey.get(e.tagKey)! : null,
          title: e.title,
          startTime,
          endTime: new Date(startTime.getTime() + e.durationMinutes * 60_000),
          location: e.location ?? null,
          rawSourceData: { seeded: true } as Prisma.InputJsonValue,
        };
      }),
    });

    console.log(`✔ ${spec.vertical.padEnd(8)} ${spec.name}  (wall: /wall/${workspace.id})`);
    for (const u of spec.users) console.log(`    ${u.role.padEnd(6)} ${u.email}`);
  }
  console.log(`\nAll seeded users share the password from SEED_USER_PASSWORD ("${password}").`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
