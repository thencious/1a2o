export function newsletterKey(row: {
  name: string;
  emailAccountId?: string;
}): string {
  return row.emailAccountId
    ? JSON.stringify([row.emailAccountId, row.name])
    : row.name;
}
