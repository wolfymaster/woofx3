import PluginRow from './PluginRow.vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';

const meta = {
  title: 'Marketplace/PluginRow',
  component: PluginRow,
  tags: ['autodocs'],
  args: {
    name: 'Music Requests',
    developer: 'PlayLive',
    description: 'Let viewers request songs, vote, and control playback. Works with Spotify, YouTube, and SoundCloud.',
    category: 'Music',
    rating: 4.6,
    icon: 'https://placehold.co/40x40?text=🎵',
  },
} satisfies Meta<typeof PluginRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => ({
    components: { PluginRow },
    setup: () => ({ args }),
    template: '<PluginRow v-bind="args" @add="() => console.log(`Plugin added`)" />',
  }),
};
