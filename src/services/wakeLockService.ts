interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

export class ScreenWakeLockController {
  private sentinel: WakeLockSentinelLike | null = null;
  private active = false;

  private handleVisibilityChange = () => {
    if (this.active && document.visibilityState === "visible") {
      void this.acquireInternal();
    }
  };

  async acquire(): Promise<boolean> {
    this.active = true;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    return this.acquireInternal();
  }

  private async acquireInternal(): Promise<boolean> {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return false;
    }
    try {
      const nav = navigator as unknown as {
        wakeLock: { request(type: "screen"): Promise<WakeLockSentinelLike> };
      };
      this.sentinel = await nav.wakeLock.request("screen");
      return true;
    } catch {
      return false;
    }
  }

  async release(): Promise<void> {
    this.active = false;
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );
    if (this.sentinel && !this.sentinel.released) {
      try {
        await this.sentinel.release();
      } catch {
        // Released automatically when tab loses visibility
      }
    }
    this.sentinel = null;
  }
}
