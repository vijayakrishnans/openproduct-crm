import { expect, signIn, test, Workspace } from "./fixtures";

// M4: a file attached to a note is stored by the API, comes back intact, is
// invisible to another organization, and goes away with its note.
test("a note keeps its attachment, and only its organization can read it", async ({ page, workspace, http }) => {
  const contact = await workspace.createContact({ first_name: "Jane", last_name: "Smith", title: "CEO" });
  const content = `quote for Jane ${Date.now()}`;

  await signIn(page, workspace.owner.email);
  await page.getByRole("link", { name: "Contacts" }).click();
  await page.getByText("Jane Smith").click();
  await page.waitForLoadState("networkidle");

  await page.getByPlaceholder("Add a note").fill("Sent the quote.");
  await page.getByText("Show options").click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "quote.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await page.getByRole("button", { name: "Add this note" }).click();

  // The saved note links to the file, and the link downloads what was sent
  const link = page.getByRole("link", { name: "quote.txt" });
  await expect(link).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("quote.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString()).toBe(content);

  // The API holds it under this organization only
  const notes = await workspace.listNotes(contact.id);
  expect(notes).toHaveLength(1);
  const file = notes[0]!.attachments[0]!;
  expect(file).toMatchObject({ title: "quote.txt", type: "text/plain", size: content.length });
  expect(await workspace.fileStatus(file.path)).toBe(200);

  const other = await Workspace.create(http, { first_name: "Eve", last_name: "Other" });
  expect(await other.fileStatus(file.path)).toBe(404);
  expect(await other.fileStatus(file.path, workspace.orgId)).toBe(404);

  // Deleting the note deletes the file
  await workspace.deleteNote(notes[0]!.id);
  expect(await workspace.fileStatus(file.path)).toBe(404);
});
