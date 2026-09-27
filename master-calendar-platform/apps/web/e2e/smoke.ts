// End-to-end smoke test in a real browser, against a running API (:3001) + Vite (:5173)
// and freshly seeded data (npm run db:seed). Saves screenshots to docs/screenshots.
//   npm run e2e -w @mcp/web
import { mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright-core";

const BASE = process.env.WEB_URL ?? "http://localhost:5173";
const OUT = path.resolve(import.meta.dirname, "../../../docs/screenshots");
const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/w\/.+\/calendar/);
  await page.locator(".chip").first().waitFor();
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
const step = (s: string) => console.log(`✓ ${s}`);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: exe });
try {
  // ─── Parent (owner) on a laptop ───
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: "America/Los_Angeles" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { throw e; });
  await login(page, "alex@family.test");
  step("parent signs in and lands on the calendar");

  const swim = page.locator(".chip", { hasText: "Swim Practice" });
  await swim.waitFor();
  assert.match(await swim.innerText(), /Nobody yet/);
  assert.match(await swim.innerText(), /🚗\?/);
  // Shown in the household's zone (Chicago), not the device's (LA): 6:00 PM, not 4:00 PM.
  assert.match(await swim.innerText(), /6:00 PM/);
  assert.ok(await page.locator(".chip", { hasText: "Carpool: practice drop-off" }).count(), "circle event on the home calendar");
  await shot(page, "01-calendar-week");
  step("week view: colors, unassigned + needs-driver flags, household time zone, circle events");

  await swim.click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Who's this for").selectOption({ label: "Leo" });
  await page.waitForTimeout(300);
  await drawer.getByLabel("Who's driving").selectOption({ label: "Alex" });
  await page.waitForTimeout(300);
  await shot(page, "02-event-claim");
  await drawer.getByRole("button", { name: "Close" }).click();
  const claimed = page.locator(".chip", { hasText: "Swim Practice" });
  await page.waitForFunction(() => ![...document.querySelectorAll(".chip")].some((c) => c.textContent?.includes("Swim Practice") && c.textContent.includes("Nobody yet")));
  assert.match(await claimed.innerText(), /Leo/);
  assert.doesNotMatch(await claimed.innerText(), /🚗\?/);
  step("claim an unassigned event: person + driver, flags clear");

  await page.getByRole("button", { name: "Month" }).click();
  await page.locator(".month .chip").first().waitFor();
  await shot(page, "03-calendar-month");
  step("month view");

  await page.getByRole("link", { name: "Shopping" }).click();
  await page.getByLabel("Item").fill("Apples");
  await page.getByLabel("Aisle").selectOption("Produce");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator(".aisle", { hasText: "Produce" }).getByText("Apples").waitFor();
  await shot(page, "04-groceries");
  await page.getByRole("button", { name: "Send to Amazon" }).click();
  await page.locator(".handoff").waitFor();
  step("groceries: add by aisle, walking-order groups, store handoff");

  await page.getByRole("link", { name: "Lists" }).click();
  await page.getByText("Fix squeaky back door hinge").waitFor();
  await page.getByRole("button", { name: "From the calendar" }).click();
  await page.getByText(/Who's driving to/).first().waitFor();
  await shot(page, "05-lists-from-calendar");
  step("lists incl. automation-generated tasks");

  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("button", { name: "Plan this week" }).click();
  await page.locator(".plan-item").first().waitFor();
  await shot(page, "06-plan");
  await page.locator(".plan-item.suggested").first().getByRole("button", { name: "Accept" }).click();
  await page.locator(".plan-item.accepted").first().waitFor();
  step("schedule organizer: plan the week, accept a suggestion");

  await page.getByRole("link", { name: "Goals" }).click();
  await page.getByText("Clean out the garage").waitFor();
  await shot(page, "07-goals");
  step("goals with progress");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByText("Connected calendars").waitFor();
  await shot(page, "08-settings-calendars");
  step("settings: calendars");
  for (const [tab, marker] of [["People & places", "Places"], ["Members", "Invite someone"], ["Notifications", "On this device"]] as const) {
    await page.getByRole("link", { name: tab }).click();
    await page.getByText(marker, { exact: true }).waitFor();
  }
  step("every settings tab opens");

  // Wall screen: made in Settings, opened on a "tablet" with no login.
  await page.getByRole("link", { name: "Wall screen" }).click();
  await page.getByLabel("Screen name").fill("Kitchen tablet");
  await page.getByRole("button", { name: "Create link" }).click();
  const wallUrl = await page.getByLabel("Wall link").inputValue();
  assert.ok(!wallUrl.includes(page.url().split("/w/")[1]!.split("/")[0]!), "wall link isn't the workspace id");
  const tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const wall = await tv.newPage();
  wall.on("pageerror", (e) => { throw e; });
  await wall.goto(wallUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await wall.locator(".wall-clock").waitFor();
  assert.equal(await wall.locator(".topbar").count(), 0, "no app chrome on the wall");
  assert.ok(await wall.getByText("Piano lesson").isVisible());
  assert.equal(await wall.locator('meta[name="referrer"]').getAttribute("content"), "no-referrer");
  await shot(wall, "11-wall");
  await wall.setViewportSize({ width: 1080, height: 1920 });
  await shot(wall, "12-wall-portrait");
  step("wall screen: no login, big type, today + next days, chores, groceries");

  await page.reload();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Turn off" }).first().click();
  await page.waitForTimeout(500);
  await wall.reload();
  await wall.getByText("This screen was turned off.").waitFor();
  step("turning a screen off locks it out immediately");
  await tv.close();
  await ctx.close();

  // ─── Kid (viewer) on a phone ───
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const kid = await phone.newPage();
  kid.on("pageerror", (e) => { throw e; });
  await login(kid, "maya@family.test");
  assert.ok(await kid.getByText("view only").isVisible());
  await shot(kid, "09-kid-phone-calendar");
  await kid.locator(".chip").first().click();
  assert.equal(await kid.getByRole("dialog").locator("select").count(), 0, "no edit controls for viewers");
  assert.ok(await kid.getByRole("dialog").getByText("For", { exact: true }).isVisible());
  await kid.getByRole("button", { name: "Close" }).click();
  step("viewer: calendar is read-only");

  await kid.getByRole("link", { name: "Shopping" }).click();
  await kid.getByLabel("Item").fill("Popsicles");
  await kid.getByRole("button", { name: "Add", exact: true }).click();
  await kid.getByText("Popsicles").waitFor();
  assert.equal(await kid.getByRole("button", { name: "Clear bought items" }).count(), 0);
  assert.equal(await kid.locator(".star").count(), 0);
  await shot(kid, "10-kid-phone-groceries");
  step("viewer can add to groceries, can't clear or edit staples");

  await kid.getByRole("link", { name: "Goals" }).click();
  await kid.getByText("Clean out the garage").waitFor();
  assert.equal(await kid.getByRole("button", { name: "+ New goal" }).count(), 0);
  await kid.getByRole("link", { name: "Plan" }).click();
  assert.equal(await kid.getByRole("button", { name: "Plan this week" }).count(), 0);
  step("viewer: no goal creation, no planning");
  await phone.close();
  console.log(`\nAll good. Screenshots in ${OUT}`);
} finally {
  await browser.close();
}
