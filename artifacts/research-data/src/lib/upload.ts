export async function uploadImage(file: File): Promise<string> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "image/jpeg" }),
  });
  if (!res.ok) throw new Error("Failed to request upload URL");
  const { uploadURL, objectPath } = (await res.json()) as { uploadURL: string; objectPath: string };

  const put = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "image/jpeg" },
  });
  if (!put.ok) throw new Error("Failed to upload image");
  return objectPath;
}

export function imageUrl(objectKey: string): string {
  return `/api/storage/objects/${objectKey}`;
}
