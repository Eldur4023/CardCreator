Contexto del proyecto

Este repositorio incluye un framework propio llamado Osodio, distribuido en las siguientes carpetas:

include/
src/
third_party/

Estas contienen todo lo necesario para desarrollar una aplicación web utilizando dicho framework. No es necesario modificar su estructura interna salvo que sea estrictamente necesario.

Objetivo

El objetivo es replicar la funcionalidad de creación de cartas de la aplicación web ubicada en:

cardconjurer/

Importante:
Solo nos interesa el editor de cartas.
Todo lo demás (landing page, navegación, features secundarias, etc.) es irrelevante y debe ignorarse.

Alcance

Debes implementar:

Interfaz para crear cartas
Edición visual de:
Texto
Imágenes
Layout de la carta
Configuración de propiedades típicas de carta (según CardConjurer)

No es necesario:

Sistema de cuentas
Guardado en servidor
Backend complejo
Funcionalidades sociales o de exportación avanzada (salvo que sea trivial)
Enfoque recomendado
Analiza cardconjurer/
Identifica cómo funciona el editor
Qué inputs usa
Cómo renderiza la carta
Replica solo lo esencial
No copies basura
No intentes clonar todo el proyecto
Quédate con el flujo mínimo funcional
Integra con Osodio
Usa el framework como base
Mantén coherencia con su arquitectura
Resultado esperado

Una aplicación web que permita:

Crear una carta desde cero
Modificar sus propiedades visuales
Ver el resultado en tiempo real

Sin distracciones. Sin features innecesarias.