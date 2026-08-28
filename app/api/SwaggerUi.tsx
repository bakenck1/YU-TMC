"use client";

import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

export default function DockflowSwaggerUi() {
  return (
    <SwaggerUI
      url="/api/openapi.json"
      deepLinking
      displayRequestDuration
      docExpansion="list"
      filter
      tryItOutEnabled
    />
  );
}
