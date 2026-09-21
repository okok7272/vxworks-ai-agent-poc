# Public Knowledge boundary

manifest.example.json describes original demo documents/source/tests. manifest.schema.json defines metadata.
Paths are repository-relative; URL entries are metadata only. Neither implies permission to retrieve/send content.
Types: vendor, hardware, controller, source, test, log. Confidence: VERIFIED, INFERRED, UNKNOWN.
VERIFIED requires evidence scoped to a specific controller/version; inference is never promoted automatically.

No PDF parser, index, vector database, search engine or automatic loading is implemented.
Future KnowledgeProvider → host-selected excerpts → ProviderContext.knowledge. This field is data only;
the host must enforce controller scope, provenance, size and data-transmission policy.

Vendor materials with unclear redistribution rights (Wind River/VxWorks/NXP PDFs, SDK and binaries)
must not be copied into this repository. Metadata can record verified official source URL, vendor, title,
version and purpose. Original files may be user-supplied in a directory outside the repository.

CompanyKnowledge must remain external, for example an administrator-selected directory containing
controllers/, documents/, logs/, source/. No company data or directory is created here.
Future configuration should hold that path in private user settings, never in a committed manifest.
Ignore rules are a second line of defense, not proof that already tracked files are safe.
