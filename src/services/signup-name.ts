// Shared by service signup adapters. Imported on demand and bundled locally;
// generating a name makes no network request and requires no API key.
export async function generateIndonesianName(): Promise<string> {
  const { faker } = await import('@faker-js/faker/locale/id_ID')
  const name = faker.person.fullName().replace(/\s+/gu, ' ').trim()
  if (!name || name.length > 100 || !/[\p{L}]/u.test(name) || /[\p{C}<>]/u.test(name)) {
    throw new Error('Name generator returned an invalid display name')
  }
  return name
}
