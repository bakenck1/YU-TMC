"use client";

import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

export default function DockflowSwaggerUi() {
  return (
    <main className="min-h-screen bg-white">
      <SwaggerUI
        url="/api/openapi.json"
        deepLinking
        displayRequestDuration
        docExpansion="none"
        filter
        defaultModelExpandDepth={1}
        defaultModelsExpandDepth={-1}
        validatorUrl={null}
      />
    </main>
  );
}
