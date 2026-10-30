import { isRecord } from './is-record.js';

export function toTeamDetailsResponse(team: unknown) {
  const record = isRecord(team) ? team : {};

  return {
    name: record.name,
    type: record.type,
    billing_email: record.billing_email,
    contact_email: record.contact_email,
  };
}
