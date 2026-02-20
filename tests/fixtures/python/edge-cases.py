"""
Edge cases for Python parser testing
"""

from typing import (
    Optional,
    List,
    Dict,
    TypeVar,
    Generic,
    Callable,
    Union,
    Any,
    Awaitable,
    AsyncIterator,
    Iterator,
    Protocol,
    runtime_checkable,
)
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from functools import wraps
import asyncio


T = TypeVar('T')
K = TypeVar('K')
V = TypeVar('V')


# Property decorator tests
class PropertyExample:
    """Class demonstrating property usage."""

    def __init__(self, value: int):
        self._value = value
        self._cached: Optional[str] = None

    @property
    def value(self) -> int:
        """Get the value."""
        return self._value

    @value.setter
    def value(self, new_value: int) -> None:
        """Set the value."""
        self._value = new_value
        self._cached = None

    @value.deleter
    def value(self) -> None:
        """Delete the value."""
        del self._value

    @property
    def cached_string(self) -> str:
        """Get cached string representation."""
        if self._cached is None:
            self._cached = str(self._value)
        return self._cached


# Class method and static method tests
class MethodTypes:
    """Class demonstrating different method types."""

    class_variable: str = "class_var"

    def __init__(self, instance_var: str):
        self.instance_var = instance_var

    def instance_method(self) -> str:
        """Regular instance method."""
        return self.instance_var

    @classmethod
    def class_method(cls, value: str) -> "MethodTypes":
        """Class method factory."""
        return cls(value)

    @staticmethod
    def static_method(a: int, b: int) -> int:
        """Static method for calculation."""
        return a + b

    @classmethod
    @property
    def class_property(cls) -> str:
        """Class property (Python 3.9+)."""
        return cls.class_variable


# Nested class tests
class OuterClass:
    """Outer class with nested classes."""

    class InnerClass:
        """First level nested class."""

        def inner_method(self) -> str:
            """Method in inner class."""
            return "inner"

        class DeeplyNested:
            """Deeply nested class."""

            def deep_method(self) -> str:
                """Method in deeply nested class."""
                return "deep"

    @staticmethod
    def create_inner() -> "OuterClass.InnerClass":
        """Create an inner class instance."""
        return OuterClass.InnerClass()


# Multiple inheritance tests
class Mixin1:
    """First mixin class."""

    def mixin1_method(self) -> str:
        return "mixin1"


class Mixin2:
    """Second mixin class."""

    def mixin2_method(self) -> str:
        return "mixin2"


class BaseClass(ABC):
    """Abstract base class."""

    @abstractmethod
    def abstract_method(self) -> str:
        """Abstract method to implement."""
        pass


class MultipleInheritance(BaseClass, Mixin1, Mixin2):
    """Class with multiple inheritance."""

    def abstract_method(self) -> str:
        return "implemented"


# Protocol tests (structural subtyping)
@runtime_checkable
class Comparable(Protocol[T]):
    """Protocol for comparable objects."""

    def __lt__(self, other: T) -> bool:
        ...

    def __gt__(self, other: T) -> bool:
        ...


# Generic class with multiple type parameters
class Container(Generic[K, V]):
    """Generic container with key-value pairs."""

    def __init__(self):
        self._data: Dict[K, V] = {}

    def get(self, key: K) -> Optional[V]:
        """Get a value by key."""
        return self._data.get(key)

    def set(self, key: K, value: V) -> None:
        """Set a value for a key."""
        self._data[key] = value


# Decorator factory tests
def retry(max_attempts: int = 3, delay: float = 1.0):
    """Decorator factory for retrying functions."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            last_exception: Optional[Exception] = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_attempts - 1:
                        import time
                        time.sleep(delay)
            raise last_exception  # type: ignore
        return wrapper
    return decorator


# Async decorator
def async_timed(func: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
    """Decorator for timing async functions."""

    @wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> T:
        import time
        start = time.perf_counter()
        result = await func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} took {elapsed:.4f}s")
        return result
    return wrapper


# Generator tests
def sync_generator(n: int) -> Iterator[int]:
    """Synchronous generator function.

    Args:
        n: Number of items to generate

    Yields:
        Numbers from 0 to n-1
    """
    for i in range(n):
        yield i


async def async_generator(n: int) -> AsyncIterator[int]:
    """Asynchronous generator function.

    Args:
        n: Number of items to generate

    Yields:
        Numbers from 0 to n-1 with delays
    """
    for i in range(n):
        await asyncio.sleep(0.01)
        yield i


# Dataclass with complex fields
@dataclass
class ComplexDataClass:
    """Dataclass with various field types."""

    name: str
    value: int
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    _private: str = field(default="private", repr=False)

    def __post_init__(self):
        """Post-initialization processing."""
        if not self.name:
            raise ValueError("name cannot be empty")


# Function with complex signature
def complex_function(
    required_arg: str,
    *args: int,
    optional_kwarg: Optional[str] = None,
    **kwargs: Union[int, str, List[int]],
) -> Dict[str, Any]:
    """Function with complex argument types.

    Args:
        required_arg: A required string argument
        *args: Variable positional arguments
        optional_kwarg: An optional keyword argument
        **kwargs: Variable keyword arguments

    Returns:
        A dictionary with all arguments
    """
    return {
        "required": required_arg,
        "args": args,
        "optional": optional_kwarg,
        "kwargs": kwargs,
    }


# Private and dunder method tests
class PrivateMethods:
    """Class with various private method patterns."""

    def __init__(self):
        self._protected = "protected"
        self.__private = "private"

    def _protected_method(self) -> str:
        """Protected method (single underscore)."""
        return self._protected

    def __private_method(self) -> str:
        """Private method (name mangling)."""
        return self.__private

    def __str__(self) -> str:
        """String representation."""
        return f"PrivateMethods({self._protected})"

    def __repr__(self) -> str:
        """Repr representation."""
        return f"PrivateMethods(protected={self._protected!r})"


# Lambda and inline functions (stored as variables)
square: Callable[[int], int] = lambda x: x ** 2
add: Callable[[int, int], int] = lambda a, b: a + b


# Module-level constants
EDGE_CASE_CONSTANT: str = "edge_case_value"
NUMERIC_CONSTANT: int = 42
COMPLEX_CONSTANT: Dict[str, List[int]] = {"numbers": [1, 2, 3]}


__all__ = [
    "PropertyExample",
    "MethodTypes",
    "OuterClass",
    "MultipleInheritance",
    "Container",
    "ComplexDataClass",
    "complex_function",
    "sync_generator",
    "async_generator",
]
