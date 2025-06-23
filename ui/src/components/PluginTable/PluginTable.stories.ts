import PluginTable from './PluginTable.vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';

const meta = {
  title: 'Marketplace/PluginTable',
  component: PluginTable,
  tags: ['autodocs'],
  args: {
    plugins: [
      {
        name: 'Music Requests',
        developer: 'PlayLive',
        description: 'Let viewers request songs and control playback.',
        category: 'Music',
        rating: 4.6,
        icon: 'https://placehold.co/40x40?text=🎵',
      },
      {
        name: 'Chat Overlay',
        developer: 'StreamBuddy',
        description: 'Display messages as overlays on stream.',
        category: 'Chat',
        rating: 4.8,
        icon: 'https://placehold.co/40x40?text=💬',
      },
      {
        name: 'Donation Tracker',
        developer: 'TipsStream',
        description: 'Customize alerts for subs, follows, and donations.',
        category: 'Donations',
        rating: 4.7,
        icon: 'https://placehold.co/40x40?text=🔔',
      },
    ],
  },
} satisfies Meta<typeof PluginTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => ({
    components: { PluginTable },
    setup: () => ({ args }),
    template: `<PluginTable v-bind="args" @add-to-workflow="(plugin) => console.log('Add to workflow:', plugin)" />`,
  }),
};
