import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SearchBar from './SearchBar.vue';

const meta = {
  title: 'Marketplace/SearchBar',
  component: SearchBar,
  args: {
    placeholder: 'Search plugins...',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
