import SortDropdown from './SortDropdown.vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';

const meta = {
  title: 'Marketplace/SortDropdown',
  component: SortDropdown,
  tags: ['autodocs'],
  args: {
    modelValue: 'Featured',
    options: ['Featured', 'Newest', 'Rating'],
  },
} satisfies Meta<typeof SortDropdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => ({
    components: { SortDropdown },
    setup: () => ({ args }),
    template: '<SortDropdown v-bind="args" v-model="args.modelValue" />',
  }),
};
