// The demo's sample exchange.
// ---------------------------------------------------------------------------
// The prompt is deliberately the kind of thing people actually write: a real
// request, with real requirements, wrapped in the greeting/softener/sign-off
// layer that carries no instruction. It is NOT padded to make the optimizer
// look good — every phrase in it is one a person would type without thinking.
//
// Nothing here is a promise. The token counts shown next to it are computed at
// runtime by the same estimator the extension uses, and the tightened version
// is produced at runtime by the same local optimizer. If the engine changes,
// the demo changes with it.

export const SAMPLE_PROMPT =
  "Hey there! I hope you're doing well. I'm currently working on a presentation " +
  'for my environmental science class. I was wondering if you could possibly help ' +
  'me out by creating a clear but fairly detailed outline that explains how ' +
  'renewable energy sources such as solar power and wind power are able to reduce ' +
  'carbon emissions. Basically, I would really like it to have an introduction, ' +
  'three main sections that each include some examples, and then a conclusion at ' +
  'the end. Also, please make sure that the language is easy for high school ' +
  'students to understand, while at the same time still sounding polished and ' +
  'informative. Thanks so much in advance!'

/**
 * The assistant reply, fixed and local.
 *
 * It did not come from ChatGPT, Claude, or any other model, and the demo never
 * says it did — the surface is labelled a sample throughout. It is written out
 * in full here so the exchange is useful enough to feel real: a person reading
 * the demo should get an outline they could actually present.
 *
 * Streamed in chunks, so the paragraph breaks are meaningful.
 */
export const SAMPLE_RESPONSE = [
  "Here's an outline you can build the deck from.\n\n",
  '**Introduction — 2 slides.** ',
  'Open with one number: how much of the world’s electricity still comes from burning fuel. ',
  'Then state the claim plainly — solar and wind cut emissions because they generate power without combustion.\n\n',
  '**1. Where the emissions come from.** ',
  'Electricity and heat production is the single largest source of global CO₂. ',
  'One chart: fossil generation against everything else.\n\n',
  '**2. Solar, and what it displaces.** ',
  'Photovoltaic panels turn sunlight straight into electricity — no fuel, no CO₂ at the point of generation. ',
  'Example: a rooftop array covering most of a household’s daytime demand.\n\n',
  '**3. Wind, and where it scales.** ',
  'Turbines convert moving air into electricity at utility scale. ',
  'Example: an offshore wind farm supplying a mid-sized city.\n\n',
  '**Conclusion.** ',
  'Return to the opening number. Emissions fall when clean generation *replaces* fossil generation, ',
  'not when it is simply added alongside it.\n\n',
  'Keep every slide to one claim and one piece of evidence — it is the fastest way to sound polished without sounding dense.',
]

export const SAMPLE_RESPONSE_TEXT = SAMPLE_RESPONSE.join('')

/**
 * Pacing for the stream, in milliseconds per chunk.
 *
 * Deterministic, not random: a demo that reads differently on every visit is a
 * toy. Roughly matches the cadence of a model that has already started
 * answering — fast enough not to waste the visitor's time, slow enough that the
 * measurement rail visibly climbs while it runs.
 */
export const CHUNK_MS = 108
