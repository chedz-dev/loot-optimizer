# Decisiones de diseño y evolución

Revisión: 2026-09-07. Estas decisiones describen el código local actual y sus límites; las mejoras propuestas se identifican como pendientes. Para componentes, datos y operación, ver [arquitectura](architecture.md).

## D01. JSON como persistencia de datos semiestáticos

Estado: implementado. La base editorial vive en un documento versionable y WCL en archivos locales por muestra. Se evita exigir SQLite u otro servicio de base de datos para leer y publicar datos de actualización poco frecuente.

Consecuencias: exportación estática sencilla y datos inspeccionables; no hay SQL, transacciones entre documentos, migraciones generales ni soporte de escritores distribuidos. WCL tiene controles de durabilidad y exclusión propios; la base editorial todavía no comparte esas garantías. Un futuro cambio a un servicio multiusuario debe reevaluar la persistencia, no asumir que un directorio JSON sincronizado equivale a una base transaccional.

## D02. Separar original, interpretación y vista pública

Estado: implementado parcialmente según la fuente. WCL guarda las filas originales del top seleccionado, agregados y señales; la UI recibe solo agregados. Se puede recalcular sin API, conservando fecha y contexto de la observación. Las capturas WCL heredadas sin `rawRankings` siguen siendo legibles pero no reconstruibles.

Las guías guardan estructura interpretada, notas y hash del bloque; no hay archivo histórico general del HTML original. Reinterpretar un cambio de parser sobre el mismo HTML requiere un fixture conservado o una nueva captura. `public/data` es una proyección regenerable y nunca debe editarse como fuente de verdad.

## D03. La vigencia no obliga a descargar WCL

Estado: implementado en WCL. GETs y planificación solo leen la base; el TTL de una hora determina qué omitir en una actualización explícita. Se puede navegar con datos caducados y sin credenciales. La UI distingue ausencia de captura, antigüedad y error de actualización.

No se aplica todavía a toda la aplicación: Wowhead e Icy Veins conservan carga inicial y refresco al leer. Unificar esta política es una posible evolución, no una garantía actual. Tampoco implica que iconos/tooltips no realicen solicitudes a terceros.

## D04. Actualizaciones WCL persistentes, exclusivas y reanudables

Estado: implementado. La actualización de catálogo, sincronización, reanudación y recálculo comparten un lease de archivo. Los jobs persisten sus tareas y las completadas no se repiten al reanudar. Hasta tres consultas pueden estar en vuelo; tras un fallo fatal se espera a que terminen antes de liberar el lease.

Se conserva la última captura válida ante fallos de API/formato. Escritura temporal, `fsync`, rename y respaldo protegen cada archivo; no ofrecen una transacción atómica entre snapshot, manifest y checkpoint. Una interrupción entre estos pasos se recupera revisando archivos y reanudando. Una actualización `force` puede repetir una captura guardada justo antes de perder su checkpoint; no se promete ejecución exactamente una vez.

Se persisten pausas por captura/spec/contexto y por proveedor, incluido el plazo `Retry-After`. No son pausas por item individual. Forzar la edad no elimina cuota, bloqueo ni cooldown. El plan estima el mínimo de consultas, no garantiza consumo exacto. El contador es lógico, no una medida de facturación.

## D05. Consenso editorial y popularidad son dimensiones diferentes

Estado: implementado. Wowhead e Icy Veins aportan recomendaciones; WCL aporta uso observado en una muestra seleccionada. La frecuencia de uso no demuestra mejora marginal, causalidad o prioridad de entrega de loot.

El registro de ranking habilita WH/IV con pesos 0.5/0.5. WCL está separado, deshabilitado en ese registro y con peso cero. Su módulo funciona sin alterar el ranking unificado. El motor puede describir señales de uso y su incertidumbre condicional, pero `usage-rate` no aporta un score editorial ni siquiera al habilitarse como apoyo. Ver [metodología](ranking-methodology.md).

No mezclar porcentajes de popularidad con la escala editorial 0-100 por tener el mismo rango numérico. Simulaciones, recomendaciones, uso y necesidad individual deben conservar unidades, contexto y objetivo de evaluación distintos.

## D06. Ausencia, desacuerdo y duplicado tienen significados distintos

Estado: implementado. Solo se renormalizan pesos entre recomendaciones observadas. Una spec con S en una sola fuente conserva S y muestra menor cobertura; si no tiene ninguna recomendación inequívoca se excluye. Una D/F/G publicada no se confunde con falta de evidencia.

Repetir el mismo tier no añade votos. Tiers contradictorios de la misma fuente y contexto quedan ambiguos hasta identificar su condición, sin seleccionar automáticamente el más favorable. La cobertura se presenta separada del score; los escenarios de sensibilidad y `tierStable` están disponibles en la respuesta del motor, pero todavía no tienen una presentación específica en la UI. La escala de tiers y sus cortes son decisiones de producto, no diferencias de DPS medidas.

La renovación de una guía sustituye las señales anteriores de esa fuente y spec. Un item omitido no debe resucitar por conservar filas antiguas. Los adaptadores futuros deben mantener ese principio sin borrar otros contextos válidos por una sustitución demasiado amplia.

## D07. Identidad estable y procedencia independiente

Estado: implementado con catálogo canónico. Los cruces se hacen por `itemId` y clase/spec, no por nombres traducidos. Fuente de evidencia, contexto recomendado y lugar de drop son campos diferentes. El catálogo activo de rankings no incluye automáticamente todos los items que aparezcan en una guía o muestra WCL.

Wowhead aporta nombres ES por ID; EN permanece como fallback. Notas originales y detalles sin traducción específica conservan su idioma. Procedencias desconocidas o contradictorias requieren revisión, no concatenar etiquetas como si hubiera varios orígenes confirmados.

## D08. Una aplicación, dos modos de distribución

Estado: implementado. Local usa Node y permite operaciones; Pages consume archivos precalculados y oculta administración técnica. Un selector de proveedor en Rankings cambia la vista de evidencia sin requerir una API independiente por proveedor.

La publicación estática aplica una lista explícita de campos permitidos para rankings y excluye demo, configuración de fuentes, métricas internas y datos WCL. El modo baked fuerza la ocultación técnica incluso ante una bandera contradictoria. Autor, fecha editorial, tiers, notas y procedencias se conservan. Las pruebas comparan todas las combinaciones item/spec/tier y su orden en los tres modos antes y después de la proyección.

El build baked no contiene el almacenamiento WCL ni tiene dónde conservar tokens o ejecutar jobs locales. Incorporar popularidad a Pages requerirá una exportación agregada deliberada, cobertura visible, política de privacidad y generación segura. No se debe copiar `data/warcraftlogs/` a `public`.

## D09. Estado de interfaz persistente y módulos conservados

Estado: implementado. Se guardan preferencias en `localStorage` y se conservan módulos montados para reducir el parpadeo al navegar. En WCL solo la vista activa realiza lecturas/polling de su estado local. El panel diferencia recargar la vista de actualizar desde el proveedor.

La tierlist es la vista inicial de specs. Sus cards usan el icono de especialización, sin añadir el de clase, y actualmente incluyen nombre, evidencia y detalles expandibles. Las guías conservan cards de items con comentario y detalles expandibles. El icono del item abre Wowhead; el cuerpo no navega fuera de la aplicación. Estas interacciones son parte del contrato de UI que debe preservarse al cambiar datos o componentes.

## Integrar una nueva fuente

Proceso propuesto para Bloodmallet, Maxroll, Method.gg, Liquid Armory u otra fuente, sin presentarlas como integraciones existentes:

1. Definir qué mide: tier editorial, simulación, porcentaje de uso u otra señal; identificar contexto, unidades, variante, parche y límites de acceso.
2. Implementar un adaptador independiente con captura, validación, trazabilidad, fecha y persistencia. No descargar desde componentes React ni acoplar HTML al motor matemático.
3. Mapear IDs internos y semántica al contrato común. Mantener procedencia del loot separada del proveedor y la recomendación. Validar faltantes y cobertura completa del lote antes de sustituir datos.
4. Elegir granularidad de almacenamiento. `saveRankingSignals` sustituye por fuente y clase/spec, incluso con `isComplete=false`; no es seguro asumir conservación automática de múltiples bosses, métricas o variantes. Diseñar esa separación y probarla antes de importar. Filtrar las señales de un único item antes de invocar el motor.
5. Registrar fuente y tipo en `ranking-engine.js`, con estado y peso deshabilitados hasta validación. `sources.js` solo informa estado y no reemplaza este paso.
6. Si corresponde fusionar scores, justificar normalización y pesos con un objetivo verificable. Si solo aporta evidencia complementaria, mantenerla fuera del score. Fijar filtros de contexto explícitos en el punto que compone la respuesta.
7. Añadir pruebas de duplicados, ausencia, lotes vacíos completos, incompatibilidad de contextos, formato nuevo, conservación de última captura y cero llamadas durante lecturas que se definan como locales.
8. Añadir presentación y, solo si se decide publicarla, una exportación baked agregada. Comprobar que no incluye secretos ni datos crudos de jugadores.

Preparado no significa integrado: actualmente el registro enumera candidatos futuros, pero no existen capturas automáticas de todas esas fuentes ni un benchmark que determine sus pesos óptimos. Es extensibilidad por registro y normalizadores conocidos, no un sistema de plugins que interprete cualquier señal. Un tipo nuevo requiere código y pruebas; no basta con asignarle un peso.

## Deuda y mejoras pendientes identificadas

- Homologar políticas y garantías de almacenamiento editorial con WCL si se requiere actualización exclusivamente manual, respaldos y exclusión entre procesos para todas las fuentes.
- Renombrar valores heredados `sqlite-cache` / `sqlite-stale-refreshing` aún devueltos por las guías. Son etiquetas antiguas; el almacenamiento real es JSON.
- Alinear el estado informativo de `sources.js` con el registro del motor, sin confundirlo con evidencia observada.
- Diseñar explícitamente coexistencia de contextos empíricos en persistencia genérica y composición del endpoint de ranking. El emparejamiento de uso del motor no sustituye toda la validación del adaptador.
- Añadir conservación de caché editorial en CI si se desea reutilizar capturas entre ejecuciones; el workflow actual solo restaura dependencias.
- Ampliar validación de esquemas/migraciones y pruebas visuales con casos de las guías. No hay garantía de que los proveedores mantengan su HTML.
- Definir retención/compactación de jobs fallidos y capacidad de disco para una captura de todas las zonas. Los jobs completos se limitan a diez, pero los no completos pueden acumularse.
- Evaluar modelos alternativos con un conjunto de casos por parche antes de afirmar una mejora del ranking. No hay pesos de fiabilidad aprendidos ni asignación óptima individual basada en WCL.

Esta tarea de documentación no implementa esas mejoras ni habilita nuevas fuentes.
