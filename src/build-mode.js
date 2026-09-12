// Public builds never expose local administration, even if a flag is misconfigured.
export const isStaticBuild = import.meta.env.VITE_STATIC_DATA === 'true';
export const showTechnicalMetadata = !isStaticBuild && import.meta.env.VITE_SHOW_TECHNICAL_METADATA !== 'false';
