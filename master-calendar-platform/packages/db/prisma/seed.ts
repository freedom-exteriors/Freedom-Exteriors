// Local dev/test seed: one workspace per vertical, each with several logins at different
// roles, participants, contacts, and sample events (assigned, unassigned, tagged).
// Re-runnable: it removes its own previously-seeded users/workspaces first.
//
//   npm run db:seed        (from the monorepo root)
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { hash } from "@node-rs/argon2";
import type { WorkspaceVertical } from "@mcp/shared-types";
import { addHomeToCircle, createPrismaClient, createWorkspaceFromTemplate, type Prisma } from "../src/index.js";

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
  /** Items for template-seeded shopping lists, keyed by list key. */
  shopping: Record<string, { name: string; quantity?: string; category?: string; isStaple?: boolean; addedBy?: string }[]>;
  /** Tasks for template-seeded task lists, keyed by list key. */
  tasks: Record<string, { title: string; participant?: string; priority?: "low" | "normal" | "high"; dueInDays?: number }[]>;
  goals: {
    title: string;
    horizon: "short_term" | "long_term";
    participant?: string;
    targetInDays?: number;
    milestones: { title: string; done?: boolean }[];
  }[];
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
    shopping: {
      groceries: [
        { name: "Milk", quantity: "1 gal", category: "Dairy & eggs", isStaple: true },
        { name: "Eggs", quantity: "2 dozen", category: "Dairy & eggs", isStaple: true },
        { name: "Bananas", category: "Produce", isStaple: true },
        { name: "Strawberries", category: "Produce", addedBy: "maya@family.test" },
        { name: "Chicken thighs", quantity: "2 lb", category: "Meat & seafood" },
        { name: "Sourdough loaf", category: "Bakery" },
        { name: "Mac & cheese", quantity: "3 boxes", category: "Pantry", addedBy: "maya@family.test" },
      ],
      target_run: [
        { name: "Paper towels", category: "Household", isStaple: true },
        { name: "Poster board (science fair)", addedBy: "maya@family.test" },
      ],
      amazon: [{ name: "Replacement HVAC filters 20x25x1", quantity: "4-pack", category: "Household" }],
    },
    tasks: {
      honey_do: [
        { title: "Fix squeaky back door hinge", participant: "Alex", priority: "low" },
        { title: "Patch drywall in hallway", participant: "Sam", dueInDays: 10 },
        { title: "Hang shelves in Maya's room", priority: "normal" },
      ],
      chores: [
        { title: "Take out trash & recycling", participant: "Leo", dueInDays: 1 },
        { title: "Unload dishwasher", participant: "Maya", dueInDays: 0 },
      ],
    },
    goals: [
      {
        title: "Clean out the garage",
        horizon: "short_term",
        targetInDays: 30,
        milestones: [{ title: "Sort into keep / donate / trash", done: true }, { title: "Donation drop-off" }, { title: "Install wall hooks for bikes" }],
      },
      {
        title: "Family trip to Japan",
        horizon: "long_term",
        targetInDays: 400,
        milestones: [{ title: "Renew passports" }, { title: "Save $8,000" }, { title: "Book flights" }],
      },
      { title: "Read 20 books this year", horizon: "long_term", participant: "Maya", targetInDays: 300, milestones: [] },
    ],
  },
  {
    // A second household, so the carpool circle below has two families in it.
    name: "Chen Family",
    vertical: "family",
    participants: [
      { name: "Lee", color: "#0D9488" },
      { name: "Nora", color: "#E11D48" },
    ],
    users: [{ email: "lee@chen.test", role: "owner", participant: "Lee" }],
    contacts: [],
    sourceName: "Seed sample events",
    defaultParticipant: "Nora",
    events: [
      { title: "U12 Soccer Practice", tagKey: "practice", participant: "Nora", dayOffset: 1, startHourUtc: 22, durationMinutes: 90, location: "Eastside Park Field 3" },
    ],
    shopping: { groceries: [{ name: "Orange slices (team snack)", category: "Produce" }] },
    tasks: {},
    goals: [],
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
    shopping: {
      groceries: [
        { name: "Instant oatmeal", category: "Food", isStaple: true },
        { name: "Cold brew", quantity: "2", category: "Beverages" },
      ],
      dorm: [{ name: "Desk lamp", category: "Dorm" }, { name: "USB-C charger", category: "Tech" }],
    },
    tasks: {
      todo: [{ title: "Email Prof. Alvarez about lab makeup", priority: "high", dueInDays: 1 }],
      packing: [{ title: "Laptop + charger" }, { title: "Winter coat" }],
    },
    goals: [
      {
        title: "Get a B+ or better in CHEM 101",
        horizon: "short_term",
        targetInDays: 75,
        milestones: [{ title: "Go to office hours weekly" }, { title: "Finish practice midterm", done: true }],
      },
      { title: "Land a summer internship", horizon: "long_term", targetInDays: 240, milestones: [{ title: "Update résumé" }, { title: "Apply to 15 roles" }] },
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
    shopping: {
      supplies: [
        { name: "Bread flour", quantity: "4 × 50 lb", category: "Ingredients", isStaple: true },
        { name: "Pastry boxes 10\"", quantity: "200", category: "Packaging", addedBy: "casey@business.test" },
      ],
    },
    tasks: {
      maintenance: [{ title: "Replace walk-in cooler door gasket", participant: "Casey", priority: "high", dueInDays: 5 }],
      admin: [{ title: "Renew food handler certs for new hires", participant: "Morgan", dueInDays: 14 }],
    },
    goals: [
      {
        title: "Launch wholesale to 3 cafés",
        horizon: "short_term",
        targetInDays: 90,
        milestones: [{ title: "Price sheet", done: true }, { title: "Tasting samples to 5 cafés" }],
      },
      { title: "Open a second location", horizon: "long_term", targetInDays: 700, milestones: [{ title: "SBA loan pre-qualification" }] },
    ],
  },
];

const CIRCLE_NAME = "Eastside FC U12 — Carpool & Snacks";

/** A circle shared by the Rivera and Chen families: carpool drives, a snack sign-up. */
async function seedCircle() {
  const [rivera, chen] = await Promise.all(
    ["Rivera Family", "Chen Family"].map((name) => prisma.workspace.findFirstOrThrow({ where: { name, kind: "home" } })),
  );
  const alex = await prisma.user.findUniqueOrThrow({ where: { email: "alex@family.test" } });
  const lee = await prisma.user.findUniqueOrThrow({ where: { email: "lee@chen.test" } });

  const circle = await createWorkspaceFromTemplate(prisma, {
    name: CIRCLE_NAME,
    vertical: "family",
    kind: "circle",
    ownerUserId: alex.id,
  });
  await prisma.workspaceMembership.create({ data: { userId: lee.id, workspaceId: circle.id, role: "member" } });
  const riveraP = await addHomeToCircle(prisma, { circleId: circle.id, homeWorkspaceId: rivera.id, color: "#2563EB" });
  const chenP = await addHomeToCircle(prisma, { circleId: circle.id, homeWorkspaceId: chen.id, color: "#0D9488" });

  const tag = async (key: string) =>
    (await prisma.eventTagDefinition.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: circle.id, key } } })).id;
  const source = await prisma.calendarSource.create({
    data: { workspaceId: circle.id, name: "Circle plans", type: "ics_feed" },
  });
  const drives = [
    { title: "Carpool: practice drop-off", participantId: riveraP.id, day: 1 },
    { title: "Carpool: practice pick-up", participantId: chenP.id, day: 1 },
    { title: "Carpool: Saturday game", participantId: null, day: 3 },
  ];
  await prisma.event.createMany({
    data: [
      ...(await Promise.all(drives.map(async (d, i) => {
        const startTime = atDayOffset(d.day, 21 + i);
        return {
          calendarSourceId: source.id, externalUid: `seed-circle-${i}`, participantId: d.participantId,
          eventTagId: await tag("carpool"), title: d.title, startTime,
          endTime: new Date(startTime.getTime() + 30 * 60_000), rawSourceData: { seeded: true } as Prisma.InputJsonValue,
        };
      }))),
      {
        calendarSourceId: source.id, externalUid: "seed-circle-potluck", participantId: null,
        eventTagId: await tag("get_together"), title: "End-of-season team potluck",
        startTime: atDayOffset(12, 22), endTime: atDayOffset(12, 25), location: "Eastside Park pavilion",
        rawSourceData: { seeded: true } as Prisma.InputJsonValue,
      },
    ],
  });

  const bringList = await prisma.taskList.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: circle.id, key: "bring_list" } } });
  await prisma.task.createMany({
    data: [
      { title: "Orange slices — Saturday game", assignedParticipantId: chenP.id },
      { title: "Water bottles — Saturday game", assignedParticipantId: null },
      { title: "Potluck: main dish", assignedParticipantId: riveraP.id },
    ].map((t, i) => ({ ...t, workspaceId: circle.id, taskListId: bringList.id, position: i, createdByUserId: alex.id })),
  });

  console.log(`✔ circle   ${CIRCLE_NAME}  (Rivera + Chen families; alex@family.test owner, lee@chen.test member)`);
}

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
  await prisma.workspace.deleteMany({ where: { name: { in: [...workspaces.map((w) => w.name), CIRCLE_NAME] } } });
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

    const users = await prisma.user.findMany({ where: { email: { in: spec.users.map((u) => u.email) } } });
    const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));
    const ownerId = userIdByEmail.get(spec.users.find((u) => u.role === "owner")!.email)!;

    const shoppingLists = await prisma.shoppingList.findMany({ where: { workspaceId: workspace.id } });
    for (const list of shoppingLists) {
      await prisma.shoppingItem.createMany({
        data: (spec.shopping[list.key!] ?? []).map(({ addedBy, ...item }, i) => ({
          shoppingListId: list.id,
          position: i,
          addedByUserId: addedBy ? userIdByEmail.get(addedBy)! : ownerId,
          ...item,
        })),
      });
    }

    const taskLists = await prisma.taskList.findMany({ where: { workspaceId: workspace.id } });
    for (const list of taskLists) {
      await prisma.task.createMany({
        data: (spec.tasks[list.key!] ?? []).map((t, i) => ({
          workspaceId: workspace.id,
          taskListId: list.id,
          position: i,
          title: t.title,
          priority: t.priority ?? "normal",
          assignedParticipantId: pid(t.participant ?? null),
          dueAt: t.dueInDays === undefined ? null : atDayOffset(t.dueInDays, 23),
          createdByUserId: ownerId,
        })),
      });
    }

    for (const [i, g] of spec.goals.entries()) {
      await prisma.goal.create({
        data: {
          workspaceId: workspace.id,
          title: g.title,
          horizon: g.horizon,
          participantId: pid(g.participant ?? null),
          targetDate: g.targetInDays === undefined ? null : atDayOffset(g.targetInDays, 0),
          position: i,
          milestones: {
            create: g.milestones.map((m, j) => ({
              workspaceId: workspace.id,
              title: m.title,
              position: j,
              completedAt: m.done ? new Date() : null,
              createdByUserId: ownerId,
            })),
          },
        },
      });
    }

    console.log(`✔ ${spec.vertical.padEnd(8)} ${spec.name}  (wall: /wall/${workspace.id})`);
    for (const u of spec.users) console.log(`    ${u.role.padEnd(6)} ${u.email}`);
  }
  await seedCircle();
  console.log(`\nAll seeded users share the password from SEED_USER_PASSWORD ("${password}").`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
