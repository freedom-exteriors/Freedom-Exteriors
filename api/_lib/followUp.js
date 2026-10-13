// Automatic follow-up sequence for leads that go quiet.
// A job in "New Customer" or "Inspection" gets a text/email series on days
// 2, 5, 9 and 14 after it entered that stage. Stops when the job moves on.
export const DAY = 86400000;
export const FOLLOW_STAGES = ["lead", "inspection"];
export const STEPS = [
  { day: 2,  channel: "sms" },
  { day: 5,  channel: "email" },
  { day: 9,  channel: "sms" },
  { day: 14, channel: "email" },
];
const PHONE = "(651) 283-1689";

export function firstName(job) {
  return String(job.name || "").trim().split(/\s+/)[0] || "there";
}

export function messageFor(stepIndex, job) {
  const first = firstName(job);
  const rep = job.assigned ? `${job.assigned} with Freedom Exteriors` : "Freedom Exteriors";
  switch (stepIndex) {
    case 0: return { text: `Hi ${first}, it's ${rep}. Just checking in to see if you have any questions about the work we discussed. Let me know how I can help! Reply STOP to opt out.` };
    case 1: return { subject: "Checking in on your estimate", text: `Hi ${first},\n\nI wanted to confirm that you received the information we sent over. If you're ready to get started or have any questions, I'm here to help.\n\n${rep}\n${PHONE}` };
    case 2: return { text: `Hi ${first}, now that you've had some time to review everything, I'd like to see when you'd like to get your project scheduled. Call me anytime at ${PHONE}. Reply STOP to opt out.` };
    default: return { subject: "Our schedule is filling up", text: `Hi ${first},\n\nI wanted to let you know that our schedule is filling up quickly. If you're ready to move forward, call me and we'll hold your spot.\n\n${rep}\n${PHONE}` };
  }
}

// Returns { stepIndex } if a message is due now, otherwise { skip: reason }.
export function nextStep(job, now = Date.now()) {
  if (job.autoFollowUpOff) return { skip: "turned off" };
  if (!FOLLOW_STAGES.includes(job.stage)) return { skip: "stage" };
  const entered = Date.parse(job.stageAt || job.added || "");
  if (!Number.isFinite(entered)) return { skip: "no date" };
  // A new stage restarts the series.
  const state = job.autoFollowUp && job.autoFollowUp.stageEntered === entered ? job.autoFollowUp : { stageEntered: entered, sent: [] };
  const done = state.sent.length;
  if (done >= STEPS.length) return { skip: "finished" };
  if (now - entered < STEPS[done].day * DAY) return { skip: "not yet" };
  const last = state.sent[done - 1];
  if (last && now - Date.parse(last.at) < DAY) return { skip: "sent recently" };
  return { stepIndex: done, state };
}
