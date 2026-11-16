export async function importAvailability(client, adapter, service, journal) {
  const response = await client.read(adapter.entryPath);
  await journal.append({ resource: adapter.entryPath, body: response.text, state: 'received' });
  const page = adapter.parsePage(response);
  await service.ingest(page.records);
  return page.records.length;
}
