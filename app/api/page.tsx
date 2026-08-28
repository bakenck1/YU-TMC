import type { Metadata } from "next";

import DockflowSwaggerUi from "./SwaggerUi";

export const metadata: Metadata = {
  title: "Dockflow API",
  description: "Интерактивная документация тестового Dockflow API",
};

export default function DockflowApiPage() {
  return <DockflowSwaggerUi />;
}
