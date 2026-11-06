import type { Note } from './types';

/**
 * Research entries, newest first by `date` when displayed.
 * Written from the repository's README and code; see CONTENT_GUIDE.md.
 */
export const notes: Note[] = [
  {
    slug: 'defomo',
    title: 'DeFOMO: multimodal fake news detection',
    summary: 'Comparing text, image and graph models for detecting fake news across five public datasets.',
    date: '2026-10-23',
    technologies: ['PyTorch', 'Hugging Face Transformers', 'PyTorch Geometric', 'scikit-learn'],
    links: [{ label: 'source on github', href: 'https://github.com/kenichist/DeFOMO' }],
    body: `DeFOMO explores how far fake news detection can go when a model reads more than the text. It includes text-only, image-only and multimodal detectors, trained and compared on five public datasets: Fakeddit, FakeNewsNet (PolitiFact and GossipCop), CHECKED, WELFake, and PolitiFact propagation graphs from UPFD.

The multimodal model combines a BERT text encoder and a ViT image encoder with a heterogeneous graph network (GraphSAGE layers over users, posts and images), and can also take propagation features and source-credibility weights. Graphs are built separately for each data split, labels and source paths never enter node features, and a fair mode removes raw user-identity nodes, so the graph cannot leak the answer.

For a fair comparison, a benchmark matrix trains matched baselines alongside DeFOMO across datasets and random seeds: DistilBERT, BERT, RoBERTa, ResNet50, a BERT + ResNet concatenation, a CLIP linear probe, SpotFake and CAFE.

The repository holds the detector code only; datasets, trained weights and logs are not included.`,
  },
];
