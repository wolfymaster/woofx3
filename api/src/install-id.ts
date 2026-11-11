/**
 * The engine's install id: a random UUID made the first time it is needed and
 * kept in the engine settings for good. The marketplace counts the distinct
 * installs a license key downloads to by it, so it must stay the same for the
 * life of the engine's database. Nothing else gives an engine a stable
 * identity: its name is set by whoever provisions it and is absent on a local
 * engine, and client ids are API credentials. A fresh database gets a new id,
 * and so counts as a new install.
 */

/** The engine settings key the install id is kept under. */
export const INSTALL_ID_SETTING_KEY = "engine.install_id";

/** The part of the db client the install id is read and written through. */
export interface InstallIdSettings {
  getSetting(key: string): Promise<string | null>;
  /** Writes only when the key has no value, answering with the stored one either way. */
  setSettingIfAbsent(key: string, value: string): Promise<string>;
  /** Overwrites the value. */
  setSetting(key: string, value: string): Promise<void>;
}

export class EngineInstallId {
  private pending: Promise<string> | null = null;

  constructor(
    private readonly settings: InstallIdSettings,
    private readonly newId: () => string = () => crypto.randomUUID()
  ) {}

  /**
   * The install id, made and stored on first use. Reads first, then writes a
   * new id only if the key is still absent and keeps the value the write
   * answers with, so two writers racing on a fresh database (an api restart
   * overlapping the old process) settle on one id. Concurrent first calls in
   * this process share one read and write. A failure is not cached: the next
   * call tries again.
   */
  get(): Promise<string> {
    if (this.pending === null) {
      this.pending = this.load().catch((err: unknown) => {
        this.pending = null;
        throw err;
      });
    }
    return this.pending;
  }

  private async load(): Promise<string> {
    const stored = await this.settings.getSetting(INSTALL_ID_SETTING_KEY);
    if (stored) {
      return stored;
    }
    if (stored === "") {
      // An empty value counts as present to a write-if-absent, so it would
      // never be replaced; overwrite it and read back what won.
      await this.settings.setSetting(INSTALL_ID_SETTING_KEY, this.newId());
      const written = await this.settings.getSetting(INSTALL_ID_SETTING_KEY);
      if (!written) {
        throw new Error(`install id: setting ${INSTALL_ID_SETTING_KEY} is still empty after the write`);
      }
      return written;
    }
    return await this.settings.setSettingIfAbsent(INSTALL_ID_SETTING_KEY, this.newId());
  }
}
