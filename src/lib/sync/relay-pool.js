/**
 * Resilient WebSocket Nostr Relay Pool Manager
 */
export class RelayPool {
  constructor(relays = []) {
    this.relayUrls = relays;
    this.sockets = new Map(); // url -> WebSocket
    this.subscriptions = new Map(); // subId -> { filter, callback }
    this.listeners = new Set();
    this.reconnectTimers = new Map(); // url -> timerId
    this.status = 'disconnected'; // 'connected', 'syncing', 'error', 'disconnected'
  }

  updateRelays(relays) {
    const newSet = new Set(relays);
    // Close removed relays
    for (const [url, ws] of this.sockets.entries()) {
      if (!newSet.has(url)) {
        if (this.reconnectTimers.has(url)) {
          clearTimeout(this.reconnectTimers.get(url));
          this.reconnectTimers.delete(url);
        }
        ws.close();
        this.sockets.delete(url);
      }
    }
    this.relayUrls = relays;
    this.connectAll();
  }

  connectAll() {
    for (const url of this.relayUrls) {
      const existing = this.sockets.get(url);
      if (!existing || existing.readyState === WebSocket.CLOSED) {
        this.connectRelay(url);
      }
    }
  }

  connectRelay(url) {
    if (this.reconnectTimers.has(url)) {
      clearTimeout(this.reconnectTimers.get(url));
      this.reconnectTimers.delete(url);
    }
    const existing = this.sockets.get(url);
    if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      const ws = new WebSocket(url);
      this.sockets.set(url, ws);

      ws.onopen = () => {
        this.notifyStatusChange();
        // Re-subscribe existing filters on connect
        for (const [subId, { filter }] of this.subscriptions.entries()) {
          ws.send(JSON.stringify(['REQ', subId, filter]));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (!Array.isArray(data)) return;

          const type = data[0];
          if (type === 'EVENT') {
            const [, subId, nostrEvent] = data;
            const sub = this.subscriptions.get(subId);
            if (sub && typeof sub.callback === 'function') {
              sub.callback(nostrEvent, url);
            }
          } else if (type === 'EOSE') {
            const [, subId] = data;
            const sub = this.subscriptions.get(subId);
            if (sub && typeof sub.onEose === 'function') {
              sub.onEose(url);
            }
          }
        } catch (err) {
          console.error(`Error processing msg from ${url}:`, err);
        }
      };

      ws.onerror = () => {
        this.notifyStatusChange();
      };

      ws.onclose = () => {
        this.notifyStatusChange();
        // Reconnect backoff after 5 seconds if still in relay list
        if (!this.reconnectTimers.has(url)) {
          const timer = setTimeout(() => {
            this.reconnectTimers.delete(url);
            if (this.relayUrls.includes(url)) {
              this.connectRelay(url);
            }
          }, 5000);
          this.reconnectTimers.set(url, timer);
        }
      };
    } catch (err) {
      console.error(`Failed to initiate connection to relay ${url}:`, err);
    }
  }

  subscribe(subId, filter, callback, onEose) {
    this.subscriptions.set(subId, { filter, callback, onEose });
    const reqMsg = JSON.stringify(['REQ', subId, filter]);

    for (const [url, ws] of this.sockets.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(reqMsg);
      }
    }

    return () => this.unsubscribe(subId);
  }

  unsubscribe(subId) {
    if (this.subscriptions.has(subId)) {
      this.subscriptions.delete(subId);
      const closeMsg = JSON.stringify(['CLOSE', subId]);
      for (const ws of this.sockets.values()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(closeMsg);
        }
      }
    }
  }

  async publish(signedEvent) {
    const eventMsg = JSON.stringify(['EVENT', signedEvent]);
    let successCount = 0;

    for (const [url, ws] of this.sockets.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(eventMsg);
          successCount++;
        } catch (err) {
          console.error(`Failed to publish event to ${url}:`, err);
        }
      }
    }

    return successCount;
  }

  getConnectedCount() {
    let count = 0;
    for (const ws of this.sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) count++;
    }
    return count;
  }

  notifyStatusChange() {
    const count = this.getConnectedCount();
    const total = this.relayUrls.length;
    this.status = count > 0 ? 'connected' : 'disconnected';

    for (const listener of this.listeners) {
      try {
        listener({ status: this.status, connectedCount: count, totalRelays: total });
      } catch (err) {
        console.error('Relay listener error:', err);
      }
    }
  }

  onStatusChange(listener) {
    this.listeners.add(listener);
    listener({ status: this.status, connectedCount: this.getConnectedCount(), totalRelays: this.relayUrls.length });
    return () => this.listeners.delete(listener);
  }

  disconnectAll() {
    for (const ws of this.sockets.values()) {
      ws.close();
    }
    this.sockets.clear();
    this.subscriptions.clear();
  }
}
