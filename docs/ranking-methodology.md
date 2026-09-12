# Ranking de trinkets: metodología local v2

Revisión: 2026-09-07. Implementación: `server/ranking-engine.js`.

Contexto de implementación: [arquitectura](architecture.md) y [decisiones de diseño](design-decisions.md). El endpoint editorial utilizado por la UI es `/api/rankings/item`; `/api/rankings` conserva una ruta de demostración distinta.

El ranking unificado estima consenso entre recomendaciones editoriales para un
item y una especialización. Warcraft Logs mide otro fenómeno: qué trinkets llevan
los personajes del top seleccionado. Una frecuencia de uso no mide DPS marginal,
prioridad de loot, BiS ni cuánto mejorará un jugador si recibe el item.

## Investigación y elección

No hay evidencia de un algoritmo universalmente mejor para este problema. La
elección depende del objetivo, la escala y los datos disponibles. Las siguientes
comparaciones aplican los métodos publicados a nuestro caso; no son resultados
de un benchmark propio.

| Método | Qué aporta | Encaje en esta fase |
| --- | --- | --- |
| Media ponderada con evidencia observada | Contribuciones auditables y pesos explícitos; conserva el acuerdo de las fuentes en la escala elegida. | Implementado, con cobertura, ambigüedad y sensibilidad separadas. La escala y los pesos siguen siendo decisiones del producto. |
| Mediana de tiers | No necesita tratar la distancia entre S y A como una diferencia de poder; resiste una opinión extrema cuando hay suficientes fuentes. | Con dos guías equiponderadas que discrepan puede no haber una solución única. Adoptarla ahora necesitaría una regla adicional de desempate. |
| Reciprocal Rank Fusion (RRF) | Combina posiciones de varias listas sin utilizar sus puntuaciones originales. | Candidato para un futuro orden relativo, pero no preserva por sí solo el significado absoluto de una S editorial. Convertir tiers empatados en posiciones requiere otra decisión. |
| Consenso de Kemeny | Agrega preferencias por pares y contempla rankings parciales y empates. | Es más costoso y puede tener múltiples soluciones. No produce directamente tiers absolutos ni transforma uso en poder. |
| Wilson para proporciones | Expresa incertidumbre de una tasa binomial, incluso cerca de 0% y 100%. | Implementado como evidencia complementaria de uso, sin convertir su límite inferior en un tier editorial. |

El manual OECD/JRC recomienda justificar normalización, pesos, datos faltantes y
agregación, y examinar la sensibilidad del indicador compuesto. Sustenta la
transparencia y los diagnósticos adoptados, pero no determina los pesos de WoW.
[OECD/JRC, Handbook on Constructing Composite Indicators](https://www.oecd.org/content/dam/oecd/en/publications/reports/2008/08/handbook-on-constructing-composite-indicators-methodology-and-user-guide_g1gh9301/9789264043466-en.pdf).

El trabajo original de RRF evalúa recuperación de documentos y fija `k=60` durante
sus experimentos. Su ventaja en esos conjuntos no demuestra que sea superior
para trinkets. [Cormack, Clarke y Büttcher, SIGIR 2009](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf).

La investigación sobre Kemeny estudia rankings débiles/parciales y documenta la
complejidad y posible falta de unicidad del consenso.
[Amodio, D'Ambrosio y Siciliano](https://arxiv.org/abs/1502.06498).

## Cálculo editorial

Los pesos configurados actuales son Wowhead 0.5 e Icy Veins 0.5. No representan
precisiones medidas: todavía no existe un conjunto de validación que permita
afirmar que una guía es más fiable.

Para las fuentes con una recomendación válida del item:

```text
peso_efectivo(s) = peso_configurado(s) / suma(pesos de fuentes observadas)
score = suma(peso_efectivo(s) * score(s))
cobertura = suma(pesos observados) / suma(pesos de recomendación activos)
```

Una ausencia aporta `null`, no una penalización inventada. Una S disponible en
una sola guía conserva S con 50% de cobertura. S en ambas conserva S con 100% de
cobertura. Una D publicada sí aporta una evaluación baja. Una spec sin evidencia
inequívoca queda fuera del ranking.

La escala heredada es S+/S=100, A+=95, A=90, B=75, C=60, D=45, F=30, G=15.
Los cortes unificados son S>=95, A>=85, B>=70, C>=55, D>=40, F>=25 y G por debajo.
Los cortes de S/A/B se conservan por compatibilidad; ahora D/F/G no se convierten
automáticamente en C. S+ se normaliza como S y A+ cruza el umbral unificado S;
las vistas de una sola fuente conservan su etiqueta original. Esta escala es un
índice de producto, no una escala cardinal de poder validada con simulaciones.

Se selecciona contenido específico antes de `all` y luego el snapshot más
reciente de ese contexto. La persistencia sustituye los lotes completos: un item
omitido en un snapshot nuevo no recupera señales antiguas. El motor recibe las
señales vigentes de un solo item; no dispone de las omisiones de una guía que el
adaptador no le entregue.

Repetir el mismo tier en HTML no aumenta su peso. Si una misma fuente publica
tiers diferentes para el mismo item y contexto sin identificar la condición,
queda `ambiguous`: conserva tiers/notas y se excluye esa contribución hasta
resolver la variante. No se elige automáticamente la mejor. La spec puede seguir
apareciendo por otra fuente válida. `metadata.ambiguousEvidence` también expone
los conflictos de specs excluidas.

## Desacuerdo, cobertura y empates

`confidence` se mantiene por compatibilidad y significa cobertura; el nombre
explícito es `evidenceCoverage`. No es una probabilidad de acierto. Las guías
pueden compartir simulaciones/autores y no se consideran ensayos independientes.

`diagnostics.agreement` informa acuerdo, desacuerdo o fuente única; rango y
desviación ponderada del índice; y escenarios al retirar una fuente cada vez.
`tierStable` indica si el tier sobrevive a esa prueba. Con una sola fuente su
valor es `null`, pues no existe una segunda perspectiva para contrastarlo. No es
un intervalo de confianza ni una prueba de causalidad.

Las puntuaciones iguales a la precisión publicada comparten posición. La
cobertura solo ordena la presentación entre empates, sin inventar una diferencia
de tier. La ausencia de una guía reduce la cantidad de evidencia mostrada.

## Warcraft Logs

El adaptador conserva `usage-rate` como un tipo distinto. El registro global lo
deja desactivado y con peso cero. Incluso si se habilita como apoyo, su
contribución al score editorial sigue siendo `null`.

`summarizeUsageRate(signal)` necesita `metadata.count` y `sampleSize` enteros,
valida su coherencia con `numericValue` en escala 0 a 100, y calcula:

```text
uso = personajes con el trinket / personajes con equipo válido
cobertura_muestra = personajes con equipo válido / tamaño objetivo
```

Cada personaje tiene dos trinkets: no se divide el uso entre el total de slots.
Las tasas de todos los items pueden sumar 200%. El motor requiere zona,
encuentro, dificultad y partición para adjuntar uso a una recomendación y compara
esas cuatro dimensiones. No comprueba de forma independiente temporada, métrica
ni tamaño objetivo de muestra: esa coherencia adicional corresponde al adaptador
y al código que compone la consulta. Hoy los JSON de WCL se consultan en su módulo
local y no se inyectan en `/api/rankings/item`; disponer de esta función no implica
que ya exista una combinación operativa de guías y logs.

El intervalo de Wilson utiliza `z=1.959963984540054`. Para 50/100 resulta
aproximadamente 40.4% a 59.6%; el 100% de una muestra pequeña tiene más
incertidumbre que 100/100 bajo el modelo binomial.
[NIST, fórmula y comparación de intervalos de proporción](https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/propconf.htm).

El top 100 está seleccionado por rendimiento y no es una muestra aleatoria de
la población. El intervalo tiene etiqueta `conditional-binomial-model`: su 95%
es nominal bajo ese modelo, no una garantía poblacional. La proporción observada
del conjunto descargado es descriptiva. Sesgos de adquisición, item level,
estrategia, grupo, métrica y parche siguen presentes; Wilson no los elimina.

## Siguiente evaluación necesaria

Para decidir una mezcla entre simulación, guías y logs hay que fijar el objetivo
medible y reunir casos de validación por spec/contenido/parche. Comparar por
separado predicción de uso, orden editorial y mejora marginal simulada evita
evaluar una métrica como si fuera otra. Después se pueden contrastar media,
mediana, RRF y modelos aprendidos en datos de parches posteriores, documentando
sensibilidad a pesos y fuentes correlacionadas. No se añaden pesos empíricos ni
penalizaciones por tamaño de muestra sin esa calibración.
