// A job's roof measurements: Hover when it has them, else an imported EagleView
// report. Both are stored in the same shape (see api/hover.js, api/_lib/eagleview.js).
export function roofMeasurements(job) {
  if (job?.hoverMeasurements?.totalRoofArea) return job.hoverMeasurements;
  if (job?.eagleviewMeasurements?.totalRoofArea) return job.eagleviewMeasurements;
  return null;
}
