"""
Module within a package for testing.
"""

from typing import Optional


class PackageClass:
    """Class defined in a package module."""

    def __init__(self, name: str):
        self.name = name

    def get_name(self) -> str:
        """Get the name."""
        return self.name


def package_function(value: str) -> str:
    """Function defined in a package module.

    Args:
        value: Input string

    Returns:
        Processed string
    """
    return value.upper()


PACKAGE_CONSTANT = "package_value"
