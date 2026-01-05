import unittest

from src.app import _build_generation_prompt, SECRET_STYLE_PROMPT


class PromptBuilderTests(unittest.TestCase):
    def test_generation_prompt_uses_plain_style_text(self) -> None:
        user_prompt = "Example prompt"
        prompt = _build_generation_prompt(user_prompt)

        self.assertTrue(prompt.startswith(user_prompt))
        self.assertIn(SECRET_STYLE_PROMPT, prompt)
        self.assertNotIn("('", prompt, "Prompt should not contain tuple repr")


if __name__ == "__main__":
    unittest.main()
