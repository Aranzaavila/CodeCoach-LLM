import os
os.environ["UNSLOTH_SKIP_TORCHVISION_CHECK"] = "1"
os.environ["UNSLOTH_USE_FUSED_CE_LOSS"] = "0"

from unsloth import FastLanguageModel
from unsloth.chat_templates import get_chat_template
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# ── CONFIG ──────────────────────────────────────────────
MODEL_NAME     = "unsloth/llama-3-8b-Instruct-bnb-4bit"
MAX_SEQ_LENGTH = 2048
OUTPUT_DIR     = "./models/codecoach"
DATASET_PATH   = "data/dataset.jsonl"
EPOCHS         = 3
BATCH_SIZE     = 1
GRAD_ACCUM     = 8
LEARNING_RATE  = 2e-4
# ────────────────────────────────────────────────────────

print("🚀 Loading base model...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name      = MODEL_NAME,
    max_seq_length  = MAX_SEQ_LENGTH,
    load_in_4bit    = True,
)

print("🔧 Applying LoRA...")
model = FastLanguageModel.get_peft_model(
    model,
    r                   = 16,
    target_modules      = ["q_proj","k_proj","v_proj","o_proj",
                           "gate_proj","up_proj","down_proj"],
    lora_alpha          = 16,
    lora_dropout        = 0,
    bias                = "none",
    use_gradient_checkpointing = "unsloth",
)

tokenizer = get_chat_template(tokenizer, chat_template="llama-3")

print("📚 Loading dataset...")
dataset = load_dataset("json", data_files=DATASET_PATH, split="train")

def format_conversations(examples):
    texts = []
    for convo in examples["conversations"]:
        text = tokenizer.apply_chat_template(
            convo, tokenize=False, add_generation_prompt=False
        )
        texts.append(text)
    return {"text": texts}

dataset = dataset.map(format_conversations, batched=True)
print(f"✅ Dataset loaded: {len(dataset)} examples")

print("🏋️ Starting training...")
trainer = SFTTrainer(
    model        = model,
    tokenizer    = tokenizer,
    train_dataset= dataset,
    dataset_text_field = "text",
    max_seq_length     = MAX_SEQ_LENGTH,
    args = TrainingArguments(
        per_device_train_batch_size   = BATCH_SIZE,
        gradient_accumulation_steps   = GRAD_ACCUM,
        warmup_steps                  = 5,
        num_train_epochs              = EPOCHS,
        learning_rate                 = LEARNING_RATE,
        fp16                          = not __import__('torch').cuda.is_bf16_supported(),
        bf16                          = __import__('torch').cuda.is_bf16_supported(),
        logging_steps                 = 1,
        optim                         = "adamw_8bit",
        output_dir                    = OUTPUT_DIR,
        save_strategy                 = "epoch",
    ),
)

trainer.train()

print("💾 Saving model...")
model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)
print(f"✅ Model saved to {OUTPUT_DIR}")