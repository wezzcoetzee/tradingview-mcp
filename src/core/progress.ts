/** Reports `progress` out of `total` steps of a long-running core operation. */
export type ReportProgress = (progress: number, total: number) => Promise<void>;
