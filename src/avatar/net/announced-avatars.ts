/**
 * The clients the user has hidden (blocked), for the whole page: a session that replaces another after a
 * media server switch keeps hiding them, and a hidden client that leaves and comes back stays hidden.
 */
const hiddenClientIds = new Set<string>();

/** What a received announcement asks of the receiver */
export type AnnouncementOutcome = {
  /** The client was not known here, so it may not know the own avatar either */
  isNewClient: boolean;
  /** Whether the client's model is to be loaded: a known client whose avatar is unchanged, or a hidden one, is not */
  load: boolean;
};

/**
 * The avatar id each remote client of one session last announced, and which clients are hidden. Every
 * client repeats its announcement, so one that names the avatar announced last loads nothing. A hidden
 * client's announcement is still recorded, so that the avatar it last named is shown when it is shown
 * again. Pure.
 */
export class AnnouncedAvatars {
  private readonly avatarIdByClientId = new Map<string, string>();

  /** `hidden` is the page's set of hidden clients; a test passes its own */
  constructor(private readonly hidden: Set<string> = hiddenClientIds) {}

  /** Records the announcement and says whether it is from a new client and whether the model is loaded */
  receive(clientId: string, avatarId: string): AnnouncementOutcome {
    const knownAvatarId = this.avatarIdByClientId.get(clientId);
    this.avatarIdByClientId.set(clientId, avatarId);
    return {
      isNewClient: knownAvatarId === undefined,
      load: knownAvatarId !== avatarId && !this.hidden.has(clientId)
    };
  }

  /** The avatar id the client announced last, if any */
  avatarIdOf(clientId: string): string | undefined {
    return this.avatarIdByClientId.get(clientId);
  }

  /** Every client with a recorded announcement */
  clientIds(): IterableIterator<string> {
    return this.avatarIdByClientId.keys();
  }

  /** Forgets the client's announcement: the client left. Whether it is hidden is kept */
  forget(clientId: string) {
    this.avatarIdByClientId.delete(clientId);
  }

  isHidden(clientId: string): boolean {
    return this.hidden.has(clientId);
  }

  /** Hides the client: its announcements are recorded but load nothing until it is shown again */
  hide(clientId: string) {
    this.hidden.add(clientId);
  }

  /** Shows the client again; returns the avatar id it announced last, which is to be loaded now, if any */
  show(clientId: string): string | undefined {
    this.hidden.delete(clientId);
    return this.avatarIdByClientId.get(clientId);
  }
}
