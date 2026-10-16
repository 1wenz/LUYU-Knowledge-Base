import { randomUUID } from "node:crypto";
import { PlatformError } from "../platform/errors";
import { trustedOrigin } from "../platform/security";

export interface RegisteredContents {
  id: number;
  mainFrame: { url: string };
  isDestroyed(): boolean;
}
export type InvocationSource = { sender: RegisteredContents; senderFrame: { url: string } | null };
export class SenderGate {
  private readonly owners = new Map<RegisteredContents, string>();
  constructor(private readonly origin: string) {}
  register(contents: RegisteredContents): string {
    if (this.owners.has(contents)) return this.owners.get(contents)!;
    const owner = `${contents.id}:${randomUUID()}`;
    this.owners.set(contents, owner);
    return owner;
  }
  authorize(source: InvocationSource): string {
    const owner = this.owners.get(source.sender);
    if (
      !owner ||
      source.sender.isDestroyed() ||
      !source.senderFrame ||
      source.senderFrame !== source.sender.mainFrame ||
      !trustedOrigin(source.senderFrame.url, this.origin)
    )
      throw new PlatformError("UNAUTHORIZED");
    return owner;
  }
  unregister(contents: RegisteredContents): string | undefined {
    const owner = this.owners.get(contents);
    this.owners.delete(contents);
    return owner;
  }
}
