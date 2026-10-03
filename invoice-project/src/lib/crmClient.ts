// Browser side of "opened from a CRM job": /…/new?crmJob=<id>.
import type { CrmJob } from "./crm.server";
import { api } from "./clientApi";

export type { CrmJob };

/** The CRM job named in the page URL, or null when there isn't one. */
export async function crmJobFromUrl(): Promise<CrmJob | null> {
  const id = new URLSearchParams(window.location.search).get("crmJob");
  if (!id || !/^\d+$/.test(id)) return null;
  const { job } = await api<{ job: CrmJob }>(`/api/crm/job?id=${id}`);
  return job;
}

/** Customer fields both forms share, from a CRM job. */
export function customerFromCrm(job: CrmJob) {
  return {
    customerName: job.name,
    customerPhone: job.phone,
    customerEmail: job.email,
    jobAddress: job.address,
    crmJobId: job.jobId,
  };
}
