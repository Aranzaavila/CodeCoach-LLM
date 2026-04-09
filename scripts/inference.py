import os
import types
import warnings

os.environ["UNSLOTH_SKIP_TORCHVISION_CHECK"] = "1"

warnings.filterwarnings(
    "ignore",
    message=r".*Unsloth should be imported before \[transformers, peft\].*",
    category=UserWarning,
)

import torch
from peft import PeftModelForCausalLM
from transformers.models.llama import modeling_llama

_ORIGINAL_LLAMA_METHODS = {
    "peft_forward": PeftModelForCausalLM.forward,
    "causal_lm_forward": modeling_llama.LlamaForCausalLM.forward,
    "prepare_inputs_for_generation": (
        modeling_llama.LlamaForCausalLM.prepare_inputs_for_generation
    ),
    "model_forward": modeling_llama.LlamaModel.forward,
    "decoder_layer_forward": modeling_llama.LlamaDecoderLayer.forward,
    "mlp_forward": modeling_llama.LlamaMLP.forward,
    "attention_forward": modeling_llama.LlamaAttention.forward,
    "rotary_embedding_cls": modeling_llama.LlamaRotaryEmbedding,
    "sdpa_attention_forward": getattr(
        modeling_llama, "LlamaSdpaAttention", None
    ).forward
    if getattr(modeling_llama, "LlamaSdpaAttention", None) is not None
    else None,
    "flash_attention_forward": getattr(
        modeling_llama, "LlamaFlashAttention2", None
    ).forward
    if getattr(modeling_llama, "LlamaFlashAttention2", None) is not None
    else None,
}

from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template

# CONFIG
MODEL_PATH = "./models/codecoach"
MAX_SEQ_LENGTH = 2048


def _clear_generation_flags(module):
    current = module
    while current is not None:
        if hasattr(current, "_flag_for_generation"):
            delattr(current, "_flag_for_generation")
        current = getattr(current, "model", None)


def _restore_method(obj, attr_name, method):
    if obj is not None and method is not None:
        setattr(obj, attr_name, method)


def _restore_rotary_embedding(decoder_model):
    rotary_cls = _ORIGINAL_LLAMA_METHODS["rotary_embedding_cls"]
    setattr(modeling_llama, "LlamaRotaryEmbedding", rotary_cls)

    if decoder_model is None:
        return

    device = decoder_model.embed_tokens.weight.device
    decoder_model.rotary_emb = rotary_cls(config=decoder_model.config).to(device)

    for layer in getattr(decoder_model, "layers", []):
        if hasattr(layer.self_attn, "rotary_emb"):
            layer.self_attn.rotary_emb = decoder_model.rotary_emb


def _disable_unsloth_fast_inference(model):
    if hasattr(model, "_old_generate"):
        model.generate = model._old_generate

    _restore_method(model.__class__, "forward", _ORIGINAL_LLAMA_METHODS["peft_forward"])

    base_model = model.get_base_model()
    _restore_method(
        base_model.__class__,
        "forward",
        _ORIGINAL_LLAMA_METHODS["causal_lm_forward"],
    )
    _restore_method(
        base_model.__class__,
        "prepare_inputs_for_generation",
        _ORIGINAL_LLAMA_METHODS["prepare_inputs_for_generation"],
    )

    decoder_model = getattr(base_model, "model", None)
    _restore_method(
        decoder_model.__class__ if decoder_model is not None else None,
        "forward",
        _ORIGINAL_LLAMA_METHODS["model_forward"],
    )
    _restore_rotary_embedding(decoder_model)

    layers = getattr(decoder_model, "layers", None)
    if layers:
        _restore_method(
            layers[0].__class__,
            "forward",
            _ORIGINAL_LLAMA_METHODS["decoder_layer_forward"],
        )
        for layer in layers:
            layer.mlp.forward = types.MethodType(
                _ORIGINAL_LLAMA_METHODS["mlp_forward"],
                layer.mlp,
            )
            if hasattr(layer.mlp, "_unsloth_forward"):
                delattr(layer.mlp, "_unsloth_forward")

            attention_module = getattr(layer, "self_attn", None)
            if attention_module is None:
                continue

            attention_cls_name = attention_module.__class__.__name__
            if attention_cls_name == "LlamaAttention":
                method = _ORIGINAL_LLAMA_METHODS["attention_forward"]
            elif attention_cls_name == "LlamaSdpaAttention":
                method = _ORIGINAL_LLAMA_METHODS["sdpa_attention_forward"]
            elif attention_cls_name == "LlamaFlashAttention2":
                method = _ORIGINAL_LLAMA_METHODS["flash_attention_forward"]
            else:
                method = None

            _restore_method(attention_module.__class__, "forward", method)

            if hasattr(attention_module, "apply_qkv"):
                delattr(attention_module, "apply_qkv")
            if hasattr(attention_module, "apply_o"):
                delattr(attention_module, "apply_o")

    _clear_generation_flags(model)
    model.eval()

    generate_name = getattr(model.generate, "__name__", "")
    if generate_name == "unsloth_fast_generate":
        raise RuntimeError("Failed to restore the original Hugging Face generate().")

    if model.__class__.forward.__module__ == "unsloth.models.llama":
        raise RuntimeError("Failed to restore the PEFT forward() implementation.")

    if base_model.__class__.forward.__module__ == "unsloth.models.llama":
        raise RuntimeError("Failed to restore the LlamaForCausalLM forward().")

    if (
        base_model.__class__.prepare_inputs_for_generation.__module__
        == "unsloth.models.llama"
    ):
        raise RuntimeError(
            "Failed to restore prepare_inputs_for_generation() for generation."
        )

    return model


print("Loading CodeCoach...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_PATH,
    max_seq_length=MAX_SEQ_LENGTH,
    load_in_4bit=True,
)
model = _disable_unsloth_fast_inference(model)
tokenizer = get_chat_template(tokenizer, chat_template="llama-3")
print("CodeCoach ready with standard Hugging Face generation.\n")


def ask_codecoach(question):
    messages = [
        {
            "role": "system",
            "content": (
                "You are CodeCoach, a mentor-style programming mentor. "
                "You NEVER give code directly. Instead, you guide students with "
                "analogies from real life, leading questions, and small hints."
            ),
        },
        {"role": "user", "content": question},
    ]
    inputs = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=True,
    ).to("cuda")

    prompt_length = inputs["input_ids"].shape[1]

    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_new_tokens=300,
            temperature=0.7,
            do_sample=True,
            use_cache=True,
        )
    response = tokenizer.decode(outputs[0][prompt_length:], skip_special_tokens=True)
    return response


# TEST QUESTIONS
questions = [
    "How do I reverse a list in Python?",
    "I don't understand what a class is",
    "My code says 'list index out of range', what does that mean?",
]

for q in questions:
    print(f"Student: {q}")
    print(f"CodeCoach: {ask_codecoach(q)}")
    print("-" * 60)
