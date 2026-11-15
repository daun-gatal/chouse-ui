import { ClientManager } from "./clientPool";

/** Close every pooled ClickHouse client (graceful shutdown). */
export function closeAllClients(): Promise<void> {
  return ClientManager.getInstance().closeAll();
}
