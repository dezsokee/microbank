{{- define "exchange-service.fullname" -}}
{{- printf "%s-exchange-service" .Release.Name -}}
{{- end -}}

{{- define "exchange-service.labels" -}}
app.kubernetes.io/name: exchange-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "exchange-service.selectorLabels" -}}
app.kubernetes.io/name: exchange-service
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
