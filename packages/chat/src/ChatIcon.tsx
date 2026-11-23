import { Icon } from '@streaik/themes';
import type { IconName } from '@streaik/themes';

export function ChatIcon({ name }: { name: IconName }) {
  return <Icon name={name} className="chat-icon" />;
}
