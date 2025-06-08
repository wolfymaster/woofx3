import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Card from './Card.vue';

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories
const meta = {
    title: 'Card',
    component: Card,
    // This component will have an automatically generated docsPage entry: https://storybook.js.org/docs/writing-docs/autodocs
    tags: ['autodocs'],
    argTypes: {
        type: { control: 'select', options: ['workflow', 'module', 'trigger'] },
        enabled: { control: 'boolean' },
        title: { control: 'text' },
        showConfig: { control: 'boolean' },
        description: { control: 'text' },
        height: { control: 'number' },
        width: { control: 'number' },
        tags: { control: 'object' },
    },
    args: {
        type: 'workflow',
        enabled: false,
        title: 'Card Title',
        description: '',
        showConfig: false,
        tags: [],
    },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;
/*
 *👇 Render functions are a framework specific feature to allow you control on how the component renders.
 * See https://storybook.js.org/docs/api/csf
 * to learn how to use render functions.
 */
export const WorkflowEnabled: Story = {
    args: {
        type: 'workflow',
        enabled: true,
        title: '100 Bits',
        showConfig: true,
        tags: [],
    },
};

export const WorkflowDisabled: Story = {
    args: {
        type: 'workflow',
        enabled: false,
        title: '100 Bits',
        showConfig: true,
        tags: [],
    },
};

export const Module: Story = {
    args: {
        type: 'module',
        enabled: false,
        title: 'Spotify Song Requests',
        showConfig: true,
        description: 'Adds song request support for Spotify urls and search. Provides overlay for viewing currently playing song.',
        tags: [{ title: 'Music', color: 'blue' }, { title: 'Command', color: 'green' }],
    },
};

export const Trigger: Story = {
    args: {
        type: 'trigger',
        enabled: false,
        title: 'Chat Command',
        showConfig: false,
        tags: [],
    },
};
