import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("remove abandoned uploaded files", { hourUTC: 3, minuteUTC: 0 }, internal.cleanup.abandonedStorage, {});
export default crons;
