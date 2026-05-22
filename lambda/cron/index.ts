import { SQSEvent } from 'aws-lambda';

export const handler = async (event: SQSEvent): Promise<void> => {
  const { cronJobId } = JSON.parse(event.Records[0].body) as { cronJobId: string };
  const url = `${process.env.INTERNAL_API_URL}/internal/cronjob/${cronJobId}/execute`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Execute failed: ${res.status} cronJobId=${cronJobId}`);
};
