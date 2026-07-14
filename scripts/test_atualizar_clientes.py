import math
import unittest

from atualizar_clientes import (
    STAGES,
    cache_key,
    fix_mojibake,
    jitter,
    normalize_uf,
    pick_best_stage,
)


class TestNormalizeUf(unittest.TestCase):
    def test_full_state_name(self):
        self.assertEqual(normalize_uf("Minas Gerais"), "MG")

    def test_abbreviation_passthrough(self):
        self.assertEqual(normalize_uf("SP"), "SP")

    def test_lowercase_with_spaces(self):
        self.assertEqual(normalize_uf(" mg "), "MG")

    def test_accented_full_name(self):
        self.assertEqual(normalize_uf("São Paulo"), "SP")

    def test_unknown_returns_empty(self):
        self.assertEqual(normalize_uf("Narnia"), "")

    def test_empty_returns_empty(self):
        self.assertEqual(normalize_uf(""), "")


class TestCacheKey(unittest.TestCase):
    def test_lowercase_and_trim(self):
        self.assertEqual(cache_key("CENTRO ", "Joaíma", "MG"), "centro|joaíma|mg")

    def test_empty_neighborhood(self):
        self.assertEqual(cache_key("", "Contagem", "MG"), "|contagem|mg")

    def test_collapses_inner_spaces(self):
        self.assertEqual(cache_key("São  Francisco", "Itatiaiuçu", "mg"), "são francisco|itatiaiuçu|mg")


class TestPickBestStage(unittest.TestCase):
    def test_concluido_wins_over_a_visitar(self):
        best = pick_best_stage(["UC_P9UM87", "WON"])
        self.assertEqual(best["id"], "concluido")

    def test_single_stage(self):
        best = pick_best_stage(["UC_59MDOM"])
        self.assertEqual(best["id"], "negociacao")

    def test_priority_order_is_complete(self):
        priorities = [stage["priority"] for stage in STAGES]
        self.assertEqual(sorted(priorities), list(range(1, 8)))


class TestJitter(unittest.TestCase):
    def test_deterministic(self):
        a = jitter(-19.9, -43.9, "ESCOLA A", 0)
        b = jitter(-19.9, -43.9, "ESCOLA A", 0)
        self.assertEqual(a, b)

    def test_within_radius(self):
        lat, lng = jitter(-19.9, -43.9, "ESCOLA A", 5)
        dist = math.hypot(lat - -19.9, lng - -43.9)
        self.assertLessEqual(dist, 0.03)

    def test_different_inputs_differ(self):
        a = jitter(-19.9, -43.9, "ESCOLA A", 1)
        b = jitter(-19.9, -43.9, "ESCOLA B", 2)
        self.assertNotEqual(a, b)


class TestFixMojibake(unittest.TestCase):
    def test_fixes_double_encoded(self):
        self.assertEqual(fix_mojibake("JoÃ£o"), "João")

    def test_leaves_clean_text(self):
        self.assertEqual(fix_mojibake("São Paulo"), "São Paulo")


if __name__ == "__main__":
    unittest.main()
