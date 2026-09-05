export default function PrivacyPage() {
  return <article className="container page-section prose">
    <span className="eyebrow">A LITTLE CLARITY</span>
    <h1>Your home. Your information.</h1>
    <p className="lead">No account needed. Avoid faces, addresses, documents, and identifying details in photos and voice notes.</p>
    <h2>Temporary MVP storage</h2>
    <p>Without a connected backend, descriptions, notes, selections, and ratings are saved only in this tab&apos;s sessionStorage. They survive refresh and normally end when the tab closes. Photos and audio stay in memory: navigating within the app keeps them, but refreshing clears their contents. A filename may remain so you know what was attached. Nothing is uploaded or analyzed by AI in this mode.</p>
    <p>Anyone using this browser tab can see its temporary repairs. Browsers may restore closed tabs and their saved text. Delete a repair or use Clear this tab&apos;s saved data in My repairs to explicitly remove the local data. Do not use this temporary store as a backup or expect it on another device.</p>
    <h2>What happens to your submission?</h2>
    <p>When the backend is connected, an anonymous browser session keeps your description and attachments private in Convex. The legacy workflow sends text and photos to OpenAI for analysis and audio for transcription with your consent. You can edit and confirm the transcript before analysis. Your uploads are not published or used to generate catalog models.</p>
    <h2>Automatic visual repairs</h2>
    <p>When enabled, the visual workflow requires both a photo and a written description. Its initial consent covers storage in Convex, recognition and planning through OpenRouter and the selected model provider, product research through Firecrawl, and automatic paid model generation and segmentation through Tripo when a compatible model is unavailable. There is no second consent or generation screen after submission.</p>
    <p>Product and symptom search terms are sent to Firecrawl; your uploaded photo is not sent to the search service. Your description and selected photo may be processed by OpenRouter&apos;s selected provider, and the selected photo may be sent to Tripo. Avoid personal details even when they seem relevant to the repair. Provider processing, retention, and charges follow the applicable provider policies.</p>
    <p>Cached personal solutions and photo-generated models remain private. Only explicitly reviewed, non-personal references with suitable usage rights can be shared for reuse. Public web images are reference links, not permission to copy them or generate another model from them. Private AI drafts are labeled as drafts and are not published or represented as human-reviewed instructions.</p>
    <p>In the legacy workflow, Tripo generation still requires a separate explicit request after a low-risk analysis. In either workflow, editing, cancelling, or deleting a repair cannot recall information already sent to a provider, guarantee cancellation, or refund charges.</p>
    <h2>Connected-mode access and deletion</h2>
    <p>With Convex connected, My repairs belongs to this browser&apos;s anonymous session, not an account. Clearing browser storage, using another browser, or losing the session can make earlier repairs inaccessible. Anyone using the same browser profile may access its saved repairs. There is no account-recovery or cross-device sync in this MVP.</p>
    <p>Delete repairs from My repairs before clearing browser storage. This removes application records and attached media. Only outcome totals can appear publicly; feedback comments stay private. Deletion here cannot guarantee deletion from provider logs or backups.</p>
    <h2>Catalog examples</h2>
    <p>The built-in examples are unreviewed drafts. Recorded feedback is your own tab-local response, not a public rating or proof that a repair is safe. No diagnosis or repair success is simulated.</p>
    <h2 id="safety">Know when to stop</h2>
    <p>This service supports only low-risk household troubleshooting. Suggestions are not a confirmed diagnosis, professional inspection, or guarantee. Do not attempt electrical wiring, gas work, structural repairs, fixture removal, or major leak repairs. For immediate danger, leave the area if safe and contact local emergency services or the appropriate utility.</p>
    <p>Reviewed catalog models illustrate reference parts. Photo-generated Tripo models are unreviewed approximations; neither can reveal hidden components or establish real dimensions, fit, or safe force. Automatic part mapping and highlighting do not establish mechanical accuracy. Confirm a guide applies to your actual hardware and follow manufacturer instructions and stop conditions. The visual workflow stops when a usable model or reliable step target is unavailable instead of substituting a text-only repair.</p>
  </article>;
}
