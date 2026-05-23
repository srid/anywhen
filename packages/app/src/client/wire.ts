// One-time setup: build the surface client bundle over a WebSocket
// transport. `surfaceClient` walks the surface once and pre-binds each
// Cell/Collection/Stream/Event to its typed oRPC procedure refs; the
// `.use()` hooks consume those.
//
// Imperative procedures (`tasks.add`, `tasks.toggle`, `tasks.move`,
// `tasks.remove`) stay accessible via `app.rpc.surface.tasks.<verb>`.

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { surfaceClient } from "@kolu/surface/solid";
import { surface } from "../shared/surface";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/rpc/ws`;
export const ws = new WebSocket(wsUrl);

export const app = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof surface.contract, ClientRetryPluginContext>
>(surface, { websocket: ws });
