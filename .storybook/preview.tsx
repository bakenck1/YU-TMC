import type { Preview } from "@storybook/nextjs-vite";
import AppSettingsProvider from "../components/AppSettingsProvider";
import AuthProvider from "../components/AuthProvider";
import "../app/globals.css";

const preview: Preview = {
  decorators: [
    (Story) => (
      <AppSettingsProvider>
        <AuthProvider>
          <Story />
        </AuthProvider>
      </AppSettingsProvider>
    ),
  ],
  parameters: {
    layout: "centered",
    nextjs: {
      appDirectory: true,
    },
    a11y: {
      test: "error",
    },
    controls: {
      expanded: true,
    },
  },
};

export default preview;
