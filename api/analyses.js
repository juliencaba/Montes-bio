// /api/analyse.js  (Vercel serverless)
// Requires env: OPENAI_API_KEY
export default async function handler(req, res){
  if (req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }
  try{
    const { intent, docs } = req.body || {};
    if(!intent || !docs || !Array.isArray(docs) || docs.length<1){
      return res.status(400).json({error:'Missing payload'});
    }
    const lang = intent.lang === 'en' ? 'en' : 'fr';

    // Build bibliography map and compact content (truncate each doc to ~6k chars to keep token usage sane)
    const CIT = [];
    const MAX = 6000;
    const corpus = docs.map((d, i) => {
      const n = i+1;
      const url = d.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${d.pmid}/` : (d.doi ? `https://doi.org/${d.doi}` : '');
      CIT.push({ n, title:d.title||'Untitled', year:d.year||'', source:d.source||'', pmid:d.pmid||'', doi:d.doi||'', url:url||'' });
      const body = (d.text||'').replace(/\s+/g,' ').slice(0, MAX);
      return `[[${n}]] ${d.title} — ${d.source} (${d.year})${d.doi?` DOI:${d.doi}`:''}${d.pmid?` PMID:${d.pmid}`:''}
${body}`;
    }).join('\n\n-----\n\n');

    const i18n = {
      fr: {
        system: "Tu es un scientifique senior en bioprocédés viraux. Tu produis des synthèses bibliographiques de haut niveau. Tu NE fournis PAS d'instructions opératoires, ni de recettes, ni de paramètres expérimentaux. Pas d'étapes pas-à-pas. Tu écris un document conceptuel: principes, comparaisons, points d'attention, qualités critiques, choix technologiques, mais jamais de conditions opératoires.",
        userPrefix: `Demande utilisateur: vecteur=${intent.vector}; sérotype=${intent.serotype}; lignée=${intent.cellLine}; techniques=${intent.techniques.join(', ')}; mots-clés=${intent.keywords}.
À partir des articles fournis (abstracts ou texte intégral), rédige un protocole documentaire interprété, structuré ainsi:
1) Résumé de la demande et méthodologie de recherche (Europe PMC / PubMed, open access).
2) Synthèse des options par grandes étapes (production cellulaire amont, récolte/clarification, capture, concentration/diafiltration, polishing, QC, formulation) — niveau conceptuel, sans aucun paramètre opérationnel.
3) Proposition de protocole documentaire (non-opérationnel), en reliant chaque paragraphe à des notes [n] correspondant aux sources.
4) Limites et points d'attention (qualité, robustesse, comparabilité).
5) Liste finale des références [n].

Contraintes:
- Masquer toute donnée sensible (volumes, concentrations, vitesses, temps, températures, etc.).
- Interdiction de fournir un mode opératoire, une recette, ou un ordre d'opérations chiffré.
- Ajouter des marqueurs [n] (par ex. [1],[3]) aux endroits adéquats.
- Style concis, scientifique, 'AI-like', en français.
Corps documentaire des sources (tronqué au besoin):
`,
      },
      en: {
        system: "You are a senior scientist in viral bioprocessing. You produce high-level literature syntheses. You must NOT provide operational instructions, recipes, or experimental parameters. No step-by-step. Write a conceptual document: principles, comparisons, critical quality attributes, technology choices — never operational conditions.",
        userPrefix: `User request: vector=${intent.vector}; serotype=${intent.serotype}; cell line=${intent.cellLine}; techniques=${intent.techniques.join(', ')}; keywords=${intent.keywords}.
Using the provided articles (abstracts or full text), draft a documentary, interpreted protocol structured as:
1) Summary of the user request and search methodology (Europe PMC / PubMed, open access).
2) Synthesis of options by major stages (upstream cell production, harvest/clarification, capture, concentration/diafiltration, polishing, QC, formulation) — conceptual level, no operational parameters.
3) Proposed documentary protocol (non-operational), linking paragraphs to [n] footnotes referencing the sources.
4) Limitations and caveats (quality, robustness, comparability).
5) Final reference list [n].

Constraints:
- Mask all sensitive data (volumes, concentrations, speeds, times, temperatures, etc.).
- Do not provide a procedure, recipe, or numbered operational sequence.
- Add [n] markers (e.g., [1],[3]) where appropriate.
- Concise, scientific, AI-like style, in English.
Corpus (truncated if needed):
`,
      }
    };

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if(!OPENAI_API_KEY){ return res.status(500).json({error:'Missing OPENAI_API_KEY'}); }

    const messages = [
      { role:'system', content: i18n[lang].system },
      { role:'user', content: i18n[lang].userPrefix + "\n\n" + corpus }
    ];

    // OpenAI Chat Completions (GPT-4o or better)
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${OPENAI_API_KEY}`},
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        temperature: 0.3,
        max_tokens: 1500
      })
    });
    if(!r.ok){
      const err=await r.text();
      return res.status(502).json({error:'OpenAI error', detail:err});
    }
    const js=await r.json();
    const content = js.choices?.[0]?.message?.content || '';

    // Return protocol + citations mapping
    return res.status(200).json({
      protocol: content,
      citations: CIT
    });
  }catch(e){
    return res.status(500).json({error:'Unhandled', detail:String(e)});
  }
}
