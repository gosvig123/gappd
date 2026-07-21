# Speaker diarization model attribution

These Core ML assets are distributed by [Fluid Inference](https://huggingface.co/FluidInference/speaker-diarization-coreml) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The identified upstream revision is `1ed7a662fdc7109e36d822db793ee6eebdaf8594`. Fluid Inference converted the PyTorch models to Core ML for Apple hardware.

The base model is [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1). Its pipeline includes pyannote powerset speaker segmentation (Plaquet and Bredin, INTERSPEECH 2023), WeSpeaker embeddings (Wang et al., ICASSP 2023), and VBx clustering (Landini et al., Computer Speech & Language 2022).

Every payload listed in `SHA256SUMS` was independently downloaded from its `/resolve/1ed7a662fdc7109e36d822db793ee6eebdaf8594/` Hugging Face path, and its SHA-256 digest was compared with the vendored file. All 21 payloads matched; the Hugging Face tree metadata's SHA-256 LFS OIDs also matched for all 12 LFS-managed payloads. `SHA256SUMS` records the verified digests. Only files required by `OfflineDiarizerModels.load` in FluidAudio revision `300165b240c45375add402265f62410b6df33cf1` (Apache-2.0) are included.

The full model license is in `LICENSE-CC-BY-4.0.txt`.
